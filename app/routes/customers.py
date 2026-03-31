from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.auth import get_current_user
from app.schemas import CustomerCreate, CustomerResponse

router = APIRouter()


@router.get("/customers")
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
                "address": c.address
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
    )

    db.add(new_customer)
    db.commit()
    db.refresh(new_customer)

    return new_customer