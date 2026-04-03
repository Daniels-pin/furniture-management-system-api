from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.auth import get_current_user
from app.schemas import ProductCreate, ProductResponse
from typing import List

from app.utils.activity_log import log_activity, PRODUCT_CREATED

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

    log_activity(
        db,
        action=PRODUCT_CREATED,
        entity_type="product",
        entity_id=new_product.id,
        actor_user=user,
        meta={"name": new_product.name},
    )
    db.commit()

    return new_product


#  GET PRODUCTS
@router.get("/products", response_model=List[ProductResponse])
def get_products(
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    return db.query(models.Product).all()