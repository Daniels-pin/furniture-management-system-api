from decimal import Decimal
import json
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app import models
from app.auth.auth import require_role, get_current_user
from datetime import datetime, timedelta
from app.schemas import (
    OrderAdminPut,
    OrderAlertItem,
    OrderCreate,
    OrderDetailsResponse,
    OrderItemCreate,
    OrderPricingUpdate,
    OrderResponse,
    OrdersAlertsResponse,
    OrdersListResponse,
    OrderStatus,
    OrderUploadResponse,
)
from fastapi import Query
from typing import List, Optional
from app.utils.cloudinary import upload_image
from app.utils.pricing import compute_discount, compute_pricing, compute_pricing_with_discount
from pydantic import EmailStr, TypeAdapter, ValidationError
from app.utils.invoices import create_invoice_for_order, sync_invoice_from_order

router = APIRouter()
logger = logging.getLogger(__name__)


def _parse_optional_email(raw: Optional[str]) -> Optional[str]:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        return str(TypeAdapter(EmailStr).validate_python(s))
    except ValidationError as e:
        raise HTTPException(status_code=422, detail="Invalid email format") from e


def _build_order_response(order: models.Order, customer: models.Customer, items: list[models.OrderItem], user) -> dict:
    base: dict = {
        "id": order.id,
        "status": order.status,
        "due_date": order.due_date,
        "created_at": order.created_at,
        "image_url": order.image_url,
        "customer": {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "address": customer.address,
            "email": customer.email,
        },
        "items": [
            {
                "id": it.id,
                "item_name": it.item_name,
                "description": it.description,
                "quantity": it.quantity,
            }
            for it in items
        ],
    }

    if user.role in ("admin", "showroom"):
        base.update(
            {
                "total_price": order.total_price,
                "discount_type": order.discount_type,
                "discount_value": order.discount_value,
                "discount_amount": order.discount_amount,
                "final_price": order.final_price,
                "amount_paid": order.amount_paid,
                "balance": order.balance,
                "payment_status": order.payment_status,
            }
        )

    return base


@router.post("/orders", response_model=OrderResponse, response_model_exclude_none=True)
def create_order(
    # Customer must always be provided (new customer)
    customer_name: Optional[str] = Form(None),
    customer_phone: Optional[str] = Form(None),
    customer_address: Optional[str] = Form(None),
    customer_email: Optional[str] = Form(None),

    # Items (list of {item_name, description, quantity})
    items_json: Optional[str] = Form(None),
    due_date: datetime | None = Form(None),
    image: UploadFile | None = File(None),
    total_price: Decimal | None = Form(None),
    amount_paid: Decimal | None = Form(None),
    discount_type: Optional[str] = Form(None),
    discount_value: Decimal | None = Form(None),
    db: Session = Depends(get_db),
    user=Depends(require_role(["showroom", "admin"])),
):
    # 1) Parse items
    items_payload: list[OrderItemCreate] = []

    if not items_json:
        raise HTTPException(status_code=422, detail="Invalid request format")

    try:
        raw = json.loads(items_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid request format")

    try:
        items_payload = TypeAdapter(List[OrderItemCreate]).validate_python(raw)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Invalid request format")

    if not items_payload:
        raise HTTPException(status_code=422, detail="Items required")

    # 2) Validate customer (always new)
    name = (customer_name or "").strip()
    phone = (customer_phone or "").strip()
    address = (customer_address or "").strip()

    if not name or not phone or not address:
        raise HTTPException(status_code=422, detail="Customer info missing")

    email_val = _parse_optional_email(customer_email)

    # 3) Upload image (optional) before DB writes
    image_url = None
    if image is not None:
        image_url = upload_image(image)

    # 4) Pricing + discount
    pricing, discount = compute_pricing_with_discount(total_price, amount_paid, discount_type, discount_value)
    original_total = compute_pricing(total_price, None).total_price

    # 5) Transactional create (customer + order + items)
    try:
        # Session may already be inside a transaction (SQLAlchemy autobegin, or upstream usage).
        # Use a nested transaction in that case to avoid InvalidRequestError.
        had_outer_tx = db.in_transaction()
        tx = db.begin_nested() if had_outer_tx else db.begin()
        with tx:
            existing = (
                db.query(models.Customer).filter(models.Customer.phone == phone).first()
            )
            if existing:
                customer = existing
                if email_val and not (existing.email or "").strip():
                    existing.email = email_val
            else:
                customer = models.Customer(
                    name=name, phone=phone, address=address, email=email_val
                )
                db.add(customer)
            db.flush()  # get customer.id

            new_order = models.Order(
                customer_id=customer.id,
                due_date=due_date,
                created_by=user.id,
                image_url=image_url,
                total_price=original_total,
                discount_type=discount.discount_type,
                discount_value=discount.discount_value,
                discount_amount=discount.discount_amount,
                final_price=discount.final_price if discount.final_price is not None else original_total,
                amount_paid=pricing.amount_paid,
                balance=pricing.balance,
                payment_status=pricing.payment_status,
            )
            db.add(new_order)
            db.flush()  # get new_order.id

            created_items: list[models.OrderItem] = []
            for it in items_payload:
                oi = models.OrderItem(
                    order_id=new_order.id,
                    item_name=it.item_name,
                    description=it.description,
                    quantity=it.quantity,
                )
                db.add(oi)
                created_items.append(oi)
            db.flush()
            create_invoice_for_order(db, new_order, customer.id)
            db.flush()
        # If we entered with an already-open transaction, begin_nested() only releases a SAVEPOINT.
        # We must commit the outer transaction, otherwise the session will roll back on close and
        # the newly created records won't be visible to subsequent requests.
        if had_outer_tx:
            db.commit()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to create order")
        # Return a concise error for debugging; remove/normalize in production if needed.
        raise HTTPException(status_code=500, detail=f"Failed to create order: {type(e).__name__}: {e}") from e

    # 6) Build full response (customer + items)
    # Avoid extra round-trips; ids are available after flush.
    return _build_order_response(new_order, customer, created_items, user)


# Legacy JSON endpoint (kept for backward compatibility)
@router.post("/orders/json", response_model=OrderResponse, response_model_exclude_none=True)
def create_order_json(
    order: OrderCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(["showroom", "admin"])),
):
    if not order.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")

    phone = order.customer.phone.strip()
    email_val = order.customer.email
    if email_val is not None:
        email_val = str(email_val).strip() or None

    existing = db.query(models.Customer).filter(models.Customer.phone == phone).first()
    if existing:
        new_customer = existing
        if email_val and not (existing.email or "").strip():
            existing.email = email_val
    else:
        new_customer = models.Customer(
            name=order.customer.name,
            phone=phone,
            address=order.customer.address,
            email=email_val,
        )
        db.add(new_customer)
    db.flush()

    new_order = models.Order(
        customer_id=new_customer.id,
        due_date=order.due_date,
        created_by=user.id,
    )
    db.add(new_order)
    db.flush()

    items = []
    for item in order.items:
        order_item = models.OrderItem(
            order_id=new_order.id,
            item_name=item.item_name,
            description=item.description,
            quantity=item.quantity,
        )
        db.add(order_item)
        items.append(order_item)
    db.flush()
    create_invoice_for_order(db, new_order, new_customer.id)
    db.commit()
    for oi in items:
        db.refresh(oi)
    db.refresh(new_order)
    new_order.items = items
    return _build_order_response(new_order, new_customer, items, user)
    

@router.get("/orders", response_model=OrdersListResponse, response_model_exclude_none=True)
def get_orders(
    db: Session = Depends(get_db),
    user = Depends(get_current_user),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
):
    q = (
        db.query(models.Order)
        .options(joinedload(models.Order.items), joinedload(models.Order.customer))
        .join(models.Customer, models.Order.customer_id == models.Customer.id)
    )

    if status:
        allowed = {"pending", "in_progress", "completed"}
        if status not in allowed:
            raise HTTPException(status_code=400, detail="Invalid status value")
        q = q.filter(models.Order.status == status)

    if search:
        s = f"%{search.strip()}%"
        q = q.filter(
            (models.Customer.name.ilike(s)) | (models.Customer.phone.ilike(s))
        )

    total = q.count()
    total_pages = max(1, (total + limit - 1) // limit)

    offset = (page - 1) * limit
    rows = (
        q.order_by(models.Order.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    data: list[dict] = []
    for order in rows:
        customer = order.customer
        base = {
            "id": order.id,
            "status": order.status,
            "due_date": order.due_date,
            "created_at": order.created_at,
            "image_url": order.image_url,
            "customer": None
            if user.role == "factory"
            else {
                "id": customer.id,
                "name": customer.name,
                "phone": customer.phone,
                "address": customer.address,
                "email": customer.email,
            },
            "items": [
                {
                    "id": item.id,
                    "item_name": item.item_name,
                    "description": item.description,
                    "quantity": item.quantity,
                }
                for item in (order.items or [])
            ],
        }

        if user.role in ("admin", "showroom"):
            base.update(
                {
                    "total_price": order.total_price,
                    "discount_type": order.discount_type,
                    "discount_value": order.discount_value,
                    "discount_amount": order.discount_amount,
                    "final_price": order.final_price,
                    "amount_paid": order.amount_paid,
                    "balance": order.balance,
                    "payment_status": order.payment_status,
                }
            )

        data.append(base)

    return {"data": data, "total": total, "page": page, "total_pages": total_pages}


@router.get("/orders/alerts", response_model=OrdersAlertsResponse)
def get_orders_alerts(
    db: Session = Depends(get_db),
    user = Depends(get_current_user),
):
    today = datetime.utcnow()
    upcoming = today + timedelta(days=14)
    q = (
        db.query(models.Order)
        .options(joinedload(models.Order.customer))
        .filter(models.Order.due_date.isnot(None))
        .filter(models.Order.due_date <= upcoming)
        .filter(models.Order.status != "completed")
        .order_by(models.Order.due_date.asc())
    )

    due_soon_count = q.count()
    rows = q.limit(20).all()

    orders: list[dict] = []
    for o in rows:
        orders.append(
            {
                "order_id": o.id,
                "status": o.status,
                "due_date": o.due_date,
                "customer": None
                if user.role == "factory"
                else {"name": o.customer.name if o.customer else None},
            }
        )

    return {"due_soon_count": due_soon_count, "orders": orders}


@router.get("/orders/reminders")
def get_reminders(
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    today = datetime.utcnow()
    upcoming = today + timedelta(days=14)

    #  Role-based filtering
    if user.role == "showroom":
        orders = db.query(models.Order).filter(
            models.Order.created_by == user.id,
            models.Order.due_date <= upcoming,
            models.Order.due_date >= today
        ).all()
    else:
        # factory + admin
        orders = db.query(models.Order).filter(
            models.Order.due_date <= upcoming,
            models.Order.due_date >= today
        ).all()

    result = []

    for order in orders:
        result.append({
            "id": order.id,
            "due_date": order.due_date,
            "status": order.status,
            "days_remaining": (order.due_date - today).days
        })

    return result


@router.get("/orders/{order_id}", response_model=OrderDetailsResponse, response_model_exclude_none=True)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    items = db.query(models.OrderItem).filter(
        models.OrderItem.order_id == order.id
    ).all()
    customer = db.query(models.Customer).filter(
    models.Customer.id == order.customer_id
    ).first()

    base = {
        "order_id": order.id,
        "status": order.status,
        "due_date": order.due_date,
        "image_url": order.image_url,
        "customer": None
        if user.role == "factory"
        else {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "address": customer.address,
            "email": customer.email,
        },
        "items": [
            {
                "id": item.id,
                "item_name": item.item_name,
                "description": item.description,
                "quantity": item.quantity,
            }
            for item in items
        ],
    }

    if user.role in ("admin", "showroom"):
        base.update(
            {
                "total_price": order.total_price,
                "discount_type": order.discount_type,
                "discount_value": order.discount_value,
                "discount_amount": order.discount_amount,
                "final_price": order.final_price,
                "amount_paid": order.amount_paid,
                "balance": order.balance,
                "payment_status": order.payment_status,
            }
        )

    return base

@router.put("/orders/{order_id}", response_model=OrderDetailsResponse, response_model_exclude_none=True)
def put_order_admin(
    order_id: int,
    payload: OrderAdminPut,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    tp = payload.total_price if payload.total_price is not None else order.total_price
    ap = payload.amount_paid if payload.amount_paid is not None else order.amount_paid
    dt = payload.discount_type if payload.discount_type is not None else order.discount_type
    dv = payload.discount_value if payload.discount_value is not None else order.discount_value

    original_total = compute_pricing(tp, None).total_price
    discount = compute_discount(original_total, dt, dv)
    pricing = compute_pricing(discount.final_price, ap)

    order.total_price = original_total
    order.discount_type = discount.discount_type
    order.discount_value = discount.discount_value
    order.discount_amount = discount.discount_amount
    order.final_price = discount.final_price
    order.amount_paid = pricing.amount_paid
    order.balance = pricing.balance
    order.payment_status = pricing.payment_status
    order.status = payload.status.value
    order.due_date = payload.due_date

    db.query(models.OrderItem).filter(models.OrderItem.order_id == order_id).delete()
    for item in payload.items:
        db.add(
            models.OrderItem(
                order_id=order_id,
                item_name=item.item_name,
                description=item.description,
                quantity=item.quantity,
            )
        )
    db.flush()
    sync_invoice_from_order(db, order)
    db.commit()

    items = (
        db.query(models.OrderItem).filter(models.OrderItem.order_id == order.id).all()
    )
    customer = (
        db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
    )

    base = {
        "order_id": order.id,
        "status": order.status,
        "due_date": order.due_date,
        "image_url": order.image_url,
        "customer": None
        if user.role == "factory"
        else {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "address": customer.address,
            "email": customer.email,
        },
        "items": [
            {
                "id": item.id,
                "item_name": item.item_name,
                "description": item.description,
                "quantity": item.quantity,
            }
            for item in items
        ],
    }
    if user.role in ("admin", "showroom"):
        base.update(
            {
                "total_price": order.total_price,
                "discount_type": order.discount_type,
                "discount_value": order.discount_value,
                "discount_amount": order.discount_amount,
                "final_price": order.final_price,
                "amount_paid": order.amount_paid,
                "balance": order.balance,
                "payment_status": order.payment_status,
            }
        )
    return base


@router.patch("/orders/{order_id}")
def update_order_pricing(
    order_id: int,
    payload: OrderPricingUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    tp = payload.total_price if payload.total_price is not None else order.total_price
    ap = payload.amount_paid if payload.amount_paid is not None else order.amount_paid
    original_total = compute_pricing(tp, None).total_price
    discount = compute_discount(original_total, order.discount_type, order.discount_value)
    pricing = compute_pricing(discount.final_price, ap)
    order.total_price = original_total
    order.final_price = discount.final_price
    order.discount_amount = discount.discount_amount
    order.amount_paid = pricing.amount_paid
    order.balance = pricing.balance
    order.payment_status = pricing.payment_status
    sync_invoice_from_order(db, order)
    db.commit()
    db.refresh(order)

    return {
        "id": order.id,
        "total_price": order.total_price,
        "amount_paid": order.amount_paid,
        "balance": order.balance,
        "payment_status": order.payment_status,
    }

@router.delete("/orders/{order_id}")
def delete_order(
    order_id: int,
    db: Session = Depends(get_db),
    user = Depends(require_role(["admin"]))
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    db.delete(order)
    db.commit()

    return {"message": "Order deleted"}


@router.patch("/orders/{order_id}/status")
def update_order_status_patch(
    order_id: int,
    status: str = Form(...),
    db: Session = Depends(get_db),
    user=Depends(require_role(["factory", "admin"])),
):
    allowed = {"pending", "in_progress", "completed"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid status value")

    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.status = status
    db.commit()
    return {"message": "Order status updated"}


@router.post("/orders/{order_id}/mark_paid")
def mark_order_fully_paid(
    order_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.total_price is None:
        raise HTTPException(status_code=400, detail="total_price is required to mark as paid")

    tp = order.total_price
    discount = compute_discount(tp, order.discount_type, order.discount_value)
    pricing = compute_pricing(discount.final_price, discount.final_price)
    order.amount_paid = pricing.amount_paid
    order.balance = pricing.balance
    order.payment_status = pricing.payment_status
    sync_invoice_from_order(db, order)
    db.commit()
    return {"message": "Order marked as fully paid"}
