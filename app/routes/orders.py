from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.auth import require_role, get_current_user
from datetime import datetime
from app.schemas import OrderCreate, OrderPricingUpdate, OrderResponse, OrderUploadResponse
from app.schemas import OrderStatus
from datetime import datetime, timedelta
from fastapi import Query
from typing import List
from app.utils.cloudinary import upload_image
from app.utils.pricing import compute_pricing

router = APIRouter()


@router.post("/orders", response_model=OrderUploadResponse, response_model_exclude_none=True)
def create_order(
    customer_id: int = Form(...),
    product_id: int | None = Form(None),
    item_name: str | None = Form(None),
    description: str | None = Form(None),
    quantity: int = Form(...),
    due_date: datetime | None = Form(None),
    image: UploadFile | None = File(None),
    total_price: Decimal | None = Form(None),
    amount_paid: Decimal | None = Form(None),
    db: Session = Depends(get_db),
    user=Depends(require_role(["showroom", "admin"])),
):
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    resolved_item_name = None
    resolved_description = description

    if product_id is not None:
        product = db.query(models.Product).filter(models.Product.id == product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        resolved_item_name = product.name
        resolved_description = resolved_description or None
    else:
        if not item_name:
            raise HTTPException(
                status_code=422, detail="item_name is required when product_id is not provided"
            )
        resolved_item_name = item_name

    image_url = None
    if image is not None:
        image_url = upload_image(image)

    pricing = compute_pricing(total_price, amount_paid)

    new_order = models.Order(
        customer_id=customer_id,
        due_date=due_date,
        created_by=user.id,
        image_url=image_url,
        total_price=pricing.total_price,
        amount_paid=pricing.amount_paid,
        balance=pricing.balance,
        payment_status=pricing.payment_status,
    )

    db.add(new_order)
    db.commit()
    db.refresh(new_order)

    order_item = models.OrderItem(
        order_id=new_order.id,
        item_name=resolved_item_name,
        description=resolved_description,
        quantity=quantity,
    )
    db.add(order_item)
    db.commit()

    return {
        "order_id": new_order.id,
        "customer_id": customer_id,
        "product_id": product_id,
        "quantity": quantity,
        "item_name": resolved_item_name,
        "description": resolved_description,
        "image_url": new_order.image_url,
        # Pricing fields are only visible to admin; showroom can input but cannot view
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
        "status": new_order.status,
        "due_date": new_order.due_date,
    }


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
    

@router.get("/orders", response_model=List[OrderResponse], response_model_exclude_none=True)
def get_orders(
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    orders = db.query(models.Order).all()

    result = []

    for order in orders:
        items = db.query(models.OrderItem).filter(
            models.OrderItem.order_id == order.id
        ).all()
        customer = db.query(models.Customer).filter(
          models.Customer.id == order.customer_id
        ).first()

        base = {
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
                    "id": item.id,
                    "item_name": item.item_name,
                    "description": item.description,
                    "quantity": item.quantity,
                }
                for item in items
            ],
        }

        if user.role == "admin":
            base.update(
                {
                    "total_price": order.total_price,
                    "amount_paid": order.amount_paid,
                    "balance": order.balance,
                    "payment_status": order.payment_status,
                }
            )

        result.append(base)
        

    return result


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


@router.get("/orders/{order_id}", response_model=OrderResponse, response_model_exclude_none=True)
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
                "id": item.id,
                "item_name": item.item_name,
                "description": item.description,
                "quantity": item.quantity,
            }
            for item in items
        ],
    }

    if user.role == "admin":
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
