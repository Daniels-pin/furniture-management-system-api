from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.auth import forbid_factory, reject_staff, is_factory_user
from app.db.alive import product_alive
from app.schemas import ProductCreate, ProductNameResponse, ProductResponse
from typing import List, Union

from app.utils.activity_log import log_activity, PRODUCT_CREATED

router = APIRouter()


# ✅ CREATE PRODUCT
@router.post("/products", response_model=ProductResponse)
def create_product(
    product: ProductCreate,
    db: Session = Depends(get_db),
    user=Depends(forbid_factory),
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
@router.get("/products", response_model=List[Union[ProductResponse, ProductNameResponse]])
def get_products(
    db: Session = Depends(get_db),
    user=Depends(reject_staff),
):
    rows = db.query(models.Product).filter(product_alive()).order_by(models.Product.id.desc()).all()
    if is_factory_user(user):
        return [ProductNameResponse(id=p.id, name=p.name) for p in rows]
    return rows