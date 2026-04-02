from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.auth import get_current_user
from app.auth.auth import require_role
from app.schemas import CustomerCreate, CustomerPublicResponse, CustomerResponse
from typing import List
from datetime import datetime

router = APIRouter()


@router.get("/customers", response_model=List[CustomerPublicResponse], response_model_exclude_none=True)
def get_customers(
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    customers = db.query(models.Customer).all()

    result = []

    for c in customers:
        if user.role == "factory":
            # 🔒 Limited view
            result.append({
                "id": c.id,
                "name": c.name
            })
        else:
            # ✅ Full view
            result.append({
                "id": c.id,
                "name": c.name,
                "phone": c.phone,
                "address": c.address,
                "email": c.email,
                "birth_day": c.birth_day,
                "birth_month": c.birth_month,
            })

    return result

 #CREATE CUSTOMER

@router.post("/customers", response_model=CustomerResponse)
def create_customer(
    customer: CustomerCreate,
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    new_customer = models.Customer(
        name=customer.name,
        phone=customer.phone,
        address=customer.address,
        email=str(customer.email) if customer.email is not None else None,
        birth_day=customer.birth_day,
        birth_month=customer.birth_month,
    )

    db.add(new_customer)
    db.commit()
    db.refresh(new_customer)

    return new_customer


@router.get(
    "/customers/birthdays/today",
    response_model=List[CustomerPublicResponse],
    response_model_exclude_none=True,
)
def birthdays_today(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    today = datetime.utcnow()
    q = db.query(models.Customer).filter(
        models.Customer.birth_day == today.day,
        models.Customer.birth_month == today.month,
    )
    customers = q.order_by(models.Customer.id.desc()).all()

    result = []
    for c in customers:
        if user.role == "factory":
            result.append({"id": c.id, "name": c.name})
        else:
            result.append(
                {
                    "id": c.id,
                    "name": c.name,
                    "phone": c.phone,
                    "address": c.address,
                    "email": c.email,
                    "birth_day": c.birth_day,
                    "birth_month": c.birth_month,
                }
            )
    return result


@router.delete("/customers/{customer_id}")
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    has_orders = db.query(models.Order).filter(models.Order.customer_id == customer_id).first()
    if has_orders:
        raise HTTPException(
            status_code=400,
            detail="Customer has existing orders and cannot be deleted",
        )

    db.delete(customer)
    db.commit()
    return {"message": "Customer deleted"}