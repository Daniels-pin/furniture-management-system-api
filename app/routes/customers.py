import csv
from datetime import datetime
from io import StringIO
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import forbid_factory, require_role
from app.database import get_db
from app.db.alive import customer_alive
from app.schemas import CustomerCreate, CustomerPublicResponse, CustomerResponse

from app.utils.activity_log import log_activity, username_from_email, CUSTOMER_CREATED, CUSTOMER_DELETED

router = APIRouter()


def _creator_username(db: Session, customer: models.Customer) -> str | None:
    if not getattr(customer, "creator_id", None):
        return None
    u = db.query(models.User).filter(models.User.id == customer.creator_id).first()
    return username_from_email(getattr(u, "email", None)) if u else None


@router.get("/customers", response_model=List[CustomerPublicResponse], response_model_exclude_none=True)
def get_customers(
    db: Session = Depends(get_db),
    user=Depends(forbid_factory),
):
    customers = db.query(models.Customer).filter(customer_alive()).order_by(models.Customer.id.desc()).all()

    result = []

    for c in customers:
        row = {
            "id": c.id,
            "name": c.name,
            "phone": c.phone,
            "address": c.address,
            "email": c.email,
            "birth_day": c.birth_day,
            "birth_month": c.birth_month,
        }
        if user.role in ("admin", "showroom"):
            row["created_by"] = _creator_username(db, c)
        result.append(row)

    return result


@router.get("/customers/export")
def export_customer_contacts(
    kind: Literal["phones", "emails"] = Query(..., description="Export phone numbers or email addresses"),
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    rows = (
        db.query(models.Customer)
        .filter(customer_alive())
        .order_by(models.Customer.id.asc())
        .all()
    )
    buf = StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    if kind == "phones":
        writer.writerow(["phone"])
        seen: set[str] = set()
        for c in rows:
            p = (c.phone or "").strip()
            if p and p not in seen:
                seen.add(p)
                writer.writerow([p])
        filename = "customer-phones.csv"
    else:
        writer.writerow(["email"])
        seen = set()
        for c in rows:
            em = (c.email or "").strip()
            if em and em not in seen:
                seen.add(em)
                writer.writerow([em])
        filename = "customer-emails.csv"
    body = "\ufeff" + buf.getvalue()
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/customers", response_model=CustomerResponse)
def create_customer(
    customer: CustomerCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    new_customer = models.Customer(
        name=customer.name,
        phone=customer.phone,
        address=customer.address,
        email=str(customer.email) if customer.email is not None else None,
        birth_day=customer.birth_day,
        birth_month=customer.birth_month,
        creator_id=user.id,
    )

    db.add(new_customer)
    db.commit()
    db.refresh(new_customer)

    log_activity(
        db,
        action=CUSTOMER_CREATED,
        entity_type="customer",
        entity_id=new_customer.id,
        actor_user=user,
    )
    db.commit()

    label = username_from_email(getattr(user, "email", None))
    return {
        "id": new_customer.id,
        "name": new_customer.name,
        "phone": new_customer.phone,
        "address": new_customer.address,
        "email": new_customer.email,
        "birth_day": new_customer.birth_day,
        "birth_month": new_customer.birth_month,
        "created_by": label,
    }


@router.get(
    "/customers/birthdays/today",
    response_model=List[CustomerPublicResponse],
    response_model_exclude_none=True,
)
def birthdays_today(
    db: Session = Depends(get_db),
    user=Depends(forbid_factory),
):
    today = datetime.utcnow()
    q = (
        db.query(models.Customer)
        .filter(customer_alive())
        .filter(
            models.Customer.birth_day == today.day,
            models.Customer.birth_month == today.month,
        )
    )
    customers = q.order_by(models.Customer.id.desc()).all()

    result = []
    for c in customers:
        row = {
            "id": c.id,
            "name": c.name,
            "phone": c.phone,
            "address": c.address,
            "email": c.email,
            "birth_day": c.birth_day,
            "birth_month": c.birth_month,
        }
        if user.role in ("admin", "showroom"):
            row["created_by"] = _creator_username(db, c)
        result.append(row)
    return result


@router.delete("/customers/{customer_id}")
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    customer = (
        db.query(models.Customer)
        .filter(models.Customer.id == customer_id)
        .filter(customer_alive())
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    has_active_orders = (
        db.query(models.Order)
        .filter(models.Order.customer_id == customer_id)
        .filter(models.Order.deleted_at.is_(None))
        .first()
    )
    if has_active_orders:
        raise HTTPException(
            status_code=400,
            detail="Customer has active orders and cannot be moved to Trash",
        )

    cid = customer.id
    log_activity(
        db,
        action=CUSTOMER_DELETED,
        entity_type="customer",
        entity_id=cid,
        actor_user=user,
        meta={"soft_delete": True},
    )
    customer.deleted_at = datetime.utcnow()
    customer.deleted_by_id = user.id
    db.commit()
    return {"message": "Customer moved to Trash"}
