from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.auth import get_current_user
from app.schemas import ProductCreate, ProductResponse
from typing import List

router = APIRouter()


# ✅ CREATE PRODUCT
@router.post("/products", response_model=ProductResponse)
def create_product(
    product: ProductCreate,
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    new_product = models.Product(
        name=product.name,
        price=product.price,
    )

    db.add(new_product)
    db.commit()
    db.refresh(new_product)

    return new_product


#  GET PRODUCTS
@router.get("/products", response_model=List[ProductResponse])
def get_products(
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    return db.query(models.Product).all()