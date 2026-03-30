from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.auth import require_role, get_current_user
from datetime import datetime
from app.schemas import OrderCreate, OrderResponse
from app.schemas import OrderStatus
from datetime import datetime, timedelta
from fastapi import Query

router = APIRouter()


@router.post("/orders", response_model=OrderResponse)
def create_order(
    order: OrderCreate,
    db: Session = Depends(get_db),
    user = Depends(require_role(["showroom", "admin"]))
):
    if not order.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")
    
    new_customer = models.Customer(
    name=order.customer.name,
    phone=order.customer.phone,
    address=order.customer.address
)

    db.add(new_customer)
    db.commit()
    db.refresh(new_customer)
    # Create order
    new_order = models.Order(
    customer_id=new_customer.id,
    due_date=order.due_date,
    created_by=user.id
)

    db.add(new_order)
    db.commit()
    db.refresh(new_order)

    # Add items
    items = []
    for item in order.items:
      order_item = models.OrderItem(
        order_id=new_order.id,
        item_name = item.item_name,
        description = item.description,
        quantity=item.quantity
     )
    
    db.add(order_item)
    items.append(order_item)
 

    db.commit()
    new_order.items = items
    return new_order
    

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
        customer = db.query(models.Customer).filter(
          models.Customer.id == order.customer_id
        ).first()

        result.append({
    "id": order.id,
    "status": order.status,
    "due_date": order.due_date,
    "customer": {
        "name": customer.name,
        "phone": customer.phone,
        "address": customer.address
    },
    "items": [
        {
            "item_name": item.item_name,
            "description": item.description,
            "quantity": item.quantity
        } for item in items
    ]
    })
        

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
    customer = db.query(models.Customer).filter(
    models.Customer.id == order.customer_id
    ).first()

    return {
    "id": order.id,
    "status": order.status,
    "due_date": order.due_date,
    "customer": {
        "name": customer.name,
        "phone": customer.phone,
        "address": customer.address
    },
    "items": [
        {
            "item_name": item.item_name,
            "description": item.description,
            "quantity": item.quantity
        } for item in items
    ]
}

@router.put("/orders/{order_id}")
def update_order_status(
    order_id: int,
    status: OrderStatus = Query(...),
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
