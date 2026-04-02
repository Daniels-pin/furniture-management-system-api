from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.auth import get_current_user
from app.auth.auth import require_role
from app.schemas import CustomerCreate, CustomerPublicResponse, CustomerResponse
from typing import List

router = APIRouter()


@router.get("/customers", response_model=List[CustomerPublicResponse], response_model_exclude_none=True)
def get_customers(
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    customers = db.query(models.Customer).all()

    result = []

    for c in customers:
        if user.role == "manager":
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
    )

    db.add(new_customer)
    db.commit()
    db.refresh(new_customer)

    return new_customer


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