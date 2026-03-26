from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.auth import require_role, get_current_user
from datetime import datetime
from app.schemas import OrderCreate
from app.schemas import OrderStatus
from datetime import datetime, timedelta


router = APIRouter()


@router.post("/orders")
def create_order(
    order: OrderCreate,
    db: Session = Depends(get_db),
    user = Depends(require_role(["showroom", "admin"]))
):
    if not order.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")

    # Create order
    new_order = models.Order(
    customer_id=order.customer_id,
    due_date=order.due_date,
    created_by=user.id
)

    db.add(new_order)
    db.commit()
    db.refresh(new_order)

    # Add items
    for item in order.items:
      order_item = models.OrderItem(
        order_id=new_order.id,
        product_id=item.product_id,
        quantity=item.quantity
    )
    db.add(order_item)

    db.commit()

    return {"message": "Order created successfully", "order_id": new_order.id}

@router.get("/orders")
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

        result.append({
            "order_id": order.id,
            "customer_id": order.customer_id,
            "status": order.status,
            "due_date": order.due_date,
            "items": [
                {
                    "product_id": item.product_id,
                    "quantity": item.quantity
                } for item in items
            ]
        })

    return result

@router.get("/orders/{order_id}")
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

    return {
        "order_id": order.id,
        "customer_id": order.customer_id,
        "status": order.status,
        "due_date": order.due_date,
        "items": [
            {
                "product_id": item.product_id,
                "quantity": item.quantity
            } for item in items
        ]
    }

@router.put("/orders/{order_id}")
def update_order_status(
    order_id: int,
    status: OrderStatus,
    db: Session = Depends(get_db),
    user = Depends(require_role(["manager", "admin"]))
):
    allowed_status = ["pending", "in_progress", "completed", "delivered"]

    if status not in allowed_status:
        raise HTTPException(status_code=400, detail="Invalid status")

    order = db.query(models.Order).filter(models.Order.id == order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.status = status
    db.commit()

    return {"message": "Order status updated"}

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
            "order_id": order.id,
            "due_date": order.due_date,
            "status": order.status,
            "days_remaining": (order.due_date - today).days
        })

    return result