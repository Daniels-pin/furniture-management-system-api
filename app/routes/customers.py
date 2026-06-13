import csv
from datetime import datetime
from io import StringIO
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import forbid_factory, require_role
from app.database import get_db
from app.db.alive import customer_alive
from app.schemas import CustomerCreate, CustomerPublicResponse, CustomerResponse, CustomerUpdate

from app.utils.activity_log import (
    CUSTOMER_CREATED,
    CUSTOMER_DELETED,
    CUSTOMER_UPDATED,
    log_activity,
    username_from_email,
)
from app.utils.phone_format import format_nigerian_phone_e164
from app.utils.user_labels import user_label, user_labels_by_id

router = APIRouter()


def _creator_username(db: Session, customer: models.Customer) -> str | None:
    cid = getattr(customer, "creator_id", None)
    return user_label(db, int(cid) if cid else None)


@router.get("/customers")
def get_customers(
    limit: int = 20,
    offset: int = 0,
    search: str | None = Query(None, max_length=200),
    db: Session = Depends(get_db),
    user=Depends(forbid_factory),
):
    lim = max(1, min(int(limit or 20), 100))
    off = max(0, int(offset or 0))
    q = db.query(models.Customer).filter(customer_alive())
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                models.Customer.name.ilike(term),
                models.Customer.phone.ilike(term),
                models.Customer.email.ilike(term),
            )
        )
    total = q.count()
    customers = q.order_by(models.Customer.id.desc()).offset(off).limit(lim).all()

    creator_labels: dict[int, str | None] = {}
    if user.role in ("admin", "showroom"):
        creator_ids = {int(c.creator_id) for c in customers if getattr(c, "creator_id", None)}
        creator_labels = user_labels_by_id(db, creator_ids)

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
            cid = getattr(c, "creator_id", None)
            row["created_by"] = creator_labels.get(int(cid)) if cid else None
        result.append(row)

    return {"items": result, "total": total}


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
    if kind == "phones":
        writer = csv.writer(buf, lineterminator="\n", quoting=csv.QUOTE_ALL)
        writer.writerow(["phone"])
        seen: set[str] = set()
        for c in rows:
            formatted = format_nigerian_phone_e164(c.phone or "")
            if formatted and formatted not in seen:
                seen.add(formatted)
                writer.writerow([formatted])
        filename = "customer-phones.csv"
    else:
        writer = csv.writer(buf, lineterminator="\n")
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


@router.patch("/customers/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: int,
    patch: CustomerUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    customer = (
        db.query(models.Customer)
        .filter(models.Customer.id == customer_id)
        .filter(customer_alive())
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # PATCH semantics: only update fields that were actually provided by the client.
    updated: dict[str, object] = {}
    for field in patch.model_fields_set:
        val = getattr(patch, field)
        if field == "email":
            updated[field] = str(val) if val is not None else None
        else:
            updated[field] = val

    if not updated:
        # No changes requested; still return current record.
        return {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "address": customer.address,
            "email": customer.email,
            "birth_day": customer.birth_day,
            "birth_month": customer.birth_month,
            "created_by": _creator_username(db, customer),
        }

    for k, v in updated.items():
        setattr(customer, k, v)

    db.commit()
    db.refresh(customer)

    log_activity(
        db,
        action=CUSTOMER_UPDATED,
        entity_type="customer",
        entity_id=customer.id,
        actor_user=user,
        meta={"fields": sorted(list(updated.keys()))},
    )
    db.commit()

    return {
        "id": customer.id,
        "name": customer.name,
        "phone": customer.phone,
        "address": customer.address,
        "email": customer.email,
        "birth_day": customer.birth_day,
        "birth_month": customer.birth_month,
        "created_by": _creator_username(db, customer),
    }
