from decimal import Decimal
import json
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app import models
from app.auth.auth import require_role, get_current_user
from datetime import datetime
from app.schemas import OrderCreate, OrderDetailsResponse, OrderItemCreate, OrderPricingUpdate, OrderResponse, OrderUploadResponse
from app.schemas import OrderAlertItem, OrdersAlertsResponse, OrdersListResponse
from app.schemas import OrderStatus
from datetime import datetime, timedelta
from fastapi import Query
from typing import List, Optional
from app.utils.cloudinary import upload_image
from app.utils.pricing import compute_pricing
from pydantic import TypeAdapter, ValidationError

router = APIRouter()
logger = logging.getLogger(__name__)


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

    # Items (list of {item_name, description, quantity})
    items_json: Optional[str] = Form(None),
    due_date: datetime | None = Form(None),
    image: UploadFile | None = File(None),
    total_price: Decimal | None = Form(None),
    amount_paid: Decimal | None = Form(None),
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

    # 3) Upload image (optional) before DB writes
    image_url = None
    if image is not None:
        image_url = upload_image(image)

    # 4) Pricing (showroom/admin can input; only admin can view)
    pricing = compute_pricing(total_price, amount_paid)

    # 5) Transactional create (customer + order + items)
    try:
        # Session may already be inside a transaction (SQLAlchemy autobegin, or upstream usage).
        # Use a nested transaction in that case to avoid InvalidRequestError.
        had_outer_tx = db.in_transaction()
        tx = db.begin_nested() if had_outer_tx else db.begin()
        with tx:
            customer = models.Customer(name=name, phone=phone, address=address)
            db.add(customer)
            db.flush()  # get customer.id

            new_order = models.Order(
                customer_id=customer.id,
                due_date=due_date,
                created_by=user.id,
                image_url=image_url,
                total_price=pricing.total_price,
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

    new_customer = models.Customer(
        name=order.customer.name, phone=order.customer.phone, address=order.customer.address
    )

    db.add(new_customer)
    db.commit()
    db.refresh(new_customer)

    new_order = models.Order(
        customer_id=new_customer.id, due_date=order.due_date, created_by=user.id
    )

    db.add(new_order)
    db.commit()
    db.refresh(new_order)

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

    db.commit()
    new_order.items = items
    return {
        "id": new_order.id,
        "status": new_order.status,
        "due_date": new_order.due_date,
        "created_at": new_order.created_at,
        "image_url": new_order.image_url,
        **(
            {
                "total_price": new_order.total_price,
                "amount_paid": new_order.amount_paid,
                "balance": new_order.balance,
                "payment_status": new_order.payment_status,
            }
            if user.role == "admin"
            else {}
        ),
        "customer": {
            "id": new_customer.id,
            "name": new_customer.name,
            "phone": new_customer.phone,
            "address": new_customer.address,
        },
        "items": [
            {
                "id": oi.id,
                "item_name": oi.item_name,
                "description": oi.description,
                "quantity": oi.quantity,
            }
            for oi in items
        ],
    }
    

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
            if user.role == "manager"
            else {
                "id": customer.id,
                "name": customer.name,
                "phone": customer.phone,
                "address": customer.address,
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
                if user.role == "manager"
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
        # manager + admin
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
        if user.role == "manager"
        else {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "address": customer.address,
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
                "amount_paid": order.amount_paid,
                "balance": order.balance,
                "payment_status": order.payment_status,
            }
        )

    return base

@router.put("/orders/{order_id}")
def update_order_status(
    order_id: int,
    status: OrderStatus = Query(...),
    db: Session = Depends(get_db),
    user = Depends(require_role(["manager", "admin"]))
):
    allowed_status = set(OrderStatus)

    if status not in allowed_status:
        raise HTTPException(status_code=400, detail="Invalid status")

    order = db.query(models.Order).filter(models.Order.id == order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.status = status.value
    db.commit()

    return {"message": "Order status updated"}


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

    pricing = compute_pricing(payload.total_price, payload.amount_paid)
    order.total_price = pricing.total_price
    order.amount_paid = pricing.amount_paid
    order.balance = pricing.balance
    order.payment_status = pricing.payment_status
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
    user=Depends(require_role(["manager", "admin"])),
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

    pricing = compute_pricing(order.total_price, order.total_price)
    order.amount_paid = pricing.amount_paid
    order.balance = pricing.balance
    order.payment_status = pricing.payment_status
    db.commit()
    return {"message": "Order marked as fully paid"}


@router.put("/orders/{order_id}/full")
def update_order(
    order_id: int,
    order: OrderCreate,
    db: Session = Depends(get_db),
    user = Depends(require_role(["manager", "admin"]))
):
    existing_order = db.query(models.Order).filter(models.Order.id == order_id).first()

    if not existing_order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Update due date
    existing_order.due_date = order.due_date

    # Update customer
    customer = db.query(models.Customer).filter(
        models.Customer.id == existing_order.customer_id
    ).first()

    customer.name = order.customer.name
    customer.phone = order.customer.phone
    customer.address = order.customer.address

    # Delete old items
    db.query(models.OrderItem).filter(
        models.OrderItem.order_id == order_id
    ).delete()

    # Add new items
    for item in order.items:
        new_item = models.OrderItem(
            order_id=order_id,
            item_name=item.item_name,
            description=item.description,
            quantity=item.quantity
        )
        db.add(new_item)

    db.commit()

    return {"message": "Order updated successfully"}
