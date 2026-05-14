"""Factory materials inventory (separate from sales products)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session, joinedload

from app import models
from app.auth.auth import get_current_user, normalize_role, require_role
from app.database import get_db
from app.db.alive import inventory_material_alive
from app.schemas import (
    InventoryBulkDelete,
    InventoryBulkPatch,
    InventoryBulkStockLevel,
    InventoryFinancialSummary,
    InventoryMaterialCreate,
    InventoryMaterialDetailResponse,
    InventoryMaterialOut,
    InventoryMaterialQtyStats,
    InventoryMaterialUpdate,
    InventoryMovementCreate,
    InventoryMovementOut,
    InventoryPaymentCreate,
    InventoryPaymentOut,
    InventoryStockPurchaseCreate,
    InventorySupplierFinancialRow,
    InventoryUnitsResponse,
)
from app.constants import INVENTORY_UNITS
from app.utils.activity_log import (
    INVENTORY_BULK_DELETED,
    INVENTORY_BULK_STOCK_LEVEL,
    INVENTORY_BULK_UPDATED,
    INVENTORY_MATERIAL_CREATED,
    INVENTORY_MATERIAL_DELETED,
    INVENTORY_MATERIAL_UPDATED,
    INVENTORY_PAYMENT_DELETED,
    INVENTORY_PAYMENT_RECORDED,
    log_activity,
    username_from_email,
)
from app.utils.user_account import historical_attribution_label

router = APIRouter()


def _as_dec(x: object | None) -> Decimal | None:
    if x is None:
        return None
    return Decimal(str(x))


def _sum_payments_map(db: Session, material_ids: list[int]) -> dict[int, Decimal]:
    if not material_ids:
        return {}
    rows = (
        db.query(
            models.InventoryMaterialPayment.material_id,
            func.sum(models.InventoryMaterialPayment.amount),
        )
        .filter(models.InventoryMaterialPayment.material_id.in_(material_ids))
        .group_by(models.InventoryMaterialPayment.material_id)
        .all()
    )
    return {
        mid: Decimal(str(total)) if total is not None else Decimal("0")
        for mid, total in rows
    }


def _paid_for_material(db: Session, material_id: int) -> Decimal:
    v = (
        db.query(func.coalesce(func.sum(models.InventoryMaterialPayment.amount), 0))
        .filter(models.InventoryMaterialPayment.material_id == material_id)
        .scalar()
    )
    return Decimal(str(v or 0))


def _display_balance(cost: Decimal | None, paid: Decimal) -> Decimal | None:
    if cost is None:
        return None
    b = cost - paid
    if b < 0:
        return Decimal("0")
    return b


def _derive_payment_status(cost: Decimal | None, paid: Decimal) -> str:
    if cost is None:
        return "unpaid" if paid <= 0 else "partial"
    if paid >= cost:
        return "paid"
    if paid > 0:
        return "partial"
    return "unpaid"


def _sync_material_payment_status(db: Session, m: models.InventoryMaterial) -> None:
    paid = _paid_for_material(db, m.id)
    cost = _as_dec(m.cost)
    m.payment_status = _derive_payment_status(cost, paid)


def _material_to_out(
    m: models.InventoryMaterial,
    *,
    amount_paid: Decimal,
) -> InventoryMaterialOut:
    cost = _as_dec(m.cost)
    bal = _display_balance(cost, amount_paid)
    return InventoryMaterialOut(
        id=m.id,
        material_name=m.material_name,
        category=m.category,
        tracking_mode=m.tracking_mode,
        quantity=m.quantity,
        unit=m.unit,
        stock_level=m.stock_level,
        supplier_name=m.supplier_name or "",
        payment_status=_derive_payment_status(cost, amount_paid),
        cost=m.cost,
        amount_paid=amount_paid,
        balance=bal,
        notes=m.notes,
        created_at=m.created_at,
        updated_at=m.updated_at,
        added_by=historical_attribution_label(m.created_by_user),
        last_updated_by=historical_attribution_label(m.updated_by_user),
    )


def require_inventory_access(user=Depends(get_current_user)):
    if normalize_role(getattr(user, "role", None)) not in ("admin", "factory"):
        raise HTTPException(status_code=403, detail="Not authorized")
    return user


def _payment_to_out(p: models.InventoryMaterialPayment) -> InventoryPaymentOut:
    return InventoryPaymentOut(
        id=p.id,
        material_id=p.material_id,
        amount=p.amount,
        paid_at=p.paid_at,
        note=p.note,
        created_at=p.created_at,
        recorded_by=historical_attribution_label(p.created_by_user),
    )


def _get_alive(
    db: Session, material_id: int, *, with_users: bool = False
) -> models.InventoryMaterial | None:
    q = db.query(models.InventoryMaterial).filter(
        models.InventoryMaterial.id == material_id,
        inventory_material_alive(),
    )
    if with_users:
        q = q.options(
            joinedload(models.InventoryMaterial.created_by_user),
            joinedload(models.InventoryMaterial.updated_by_user),
        )
    return q.first()


def _movement_quantity_stats(db: Session, material_id: int) -> tuple[Decimal, Decimal]:
    """From movement log: totals for `added` (inbound) and `used` (consumption). Adjustments excluded."""
    total_purchased = db.query(
        func.coalesce(
            func.sum(
                case(
                    (
                        and_(
                            models.InventoryMovement.action == "added",
                            models.InventoryMovement.quantity_delta.isnot(None),
                            models.InventoryMovement.quantity_delta > 0,
                        ),
                        models.InventoryMovement.quantity_delta,
                    ),
                    else_=0,
                )
            ),
            0,
        )
    ).filter(models.InventoryMovement.material_id == material_id).scalar()
    total_used = db.query(
        func.coalesce(
            func.sum(
                case(
                    (
                        and_(
                            models.InventoryMovement.action == "used",
                            models.InventoryMovement.quantity_delta.isnot(None),
                        ),
                        -models.InventoryMovement.quantity_delta,
                    ),
                    else_=0,
                )
            ),
            0,
        )
    ).filter(models.InventoryMovement.material_id == material_id).scalar()
    return Decimal(str(total_purchased or 0)), Decimal(str(total_used or 0))


def _append_movement(
    db: Session,
    *,
    material_id: int,
    action: str,
    quantity_delta: Decimal | None,
    meta: dict[str, Any] | None,
    actor_user,
) -> models.InventoryMovement:
    row = models.InventoryMovement(
        material_id=material_id,
        action=action,
        quantity_delta=quantity_delta,
        meta=meta,
        actor_user_id=getattr(actor_user, "id", None),
        actor_username=username_from_email(getattr(actor_user, "email", None)),
    )
    db.add(row)
    return row


@router.get("/inventory/units", response_model=InventoryUnitsResponse)
def list_inventory_units(_user=Depends(require_inventory_access)):
    return InventoryUnitsResponse(units=list(INVENTORY_UNITS))


@router.get("/inventory/suppliers")
def list_inventory_suppliers(
    db: Session = Depends(get_db),
    _user=Depends(require_inventory_access),
):
    rows = (
        db.query(models.InventoryMaterial.supplier_name)
        .filter(inventory_material_alive())
        .distinct()
        .order_by(models.InventoryMaterial.supplier_name.asc())
        .all()
    )
    names = sorted(
        {((r[0] or "").strip()) for r in rows if (r[0] or "").strip()},
        key=lambda s: s.lower(),
    )
    return {"suppliers": names}


@router.get("/inventory/low-stock-count")
def inventory_low_stock_count(
    db: Session = Depends(get_db),
    _user=Depends(require_inventory_access),
):
    n = (
        db.query(func.count(models.InventoryMaterial.id))
        .filter(
            inventory_material_alive(),
            models.InventoryMaterial.stock_level == "low",
        )
        .scalar()
        or 0
    )
    return {"count": int(n)}


@router.get("/inventory/financial-summary", response_model=InventoryFinancialSummary)
def inventory_financial_summary(
    db: Session = Depends(get_db),
    _user=Depends(require_role(["admin"])),
):
    rows = db.query(models.InventoryMaterial).filter(inventory_material_alive()).all()
    pmap = _sum_payments_map(db, [m.id for m in rows])
    total_cost = Decimal("0")
    total_paid = Decimal("0")
    total_out = Decimal("0")
    for m in rows:
        paid = pmap.get(m.id, Decimal("0"))
        total_paid += paid
        c = _as_dec(m.cost)
        if c is not None:
            total_cost += c
            b = _display_balance(c, paid)
            if b is not None:
                total_out += b
    return InventoryFinancialSummary(
        total_cost=total_cost,
        total_paid=total_paid,
        total_outstanding=total_out,
        material_count=len(rows),
    )


@router.get("/inventory/supplier-financials", response_model=list[InventorySupplierFinancialRow])
def inventory_supplier_financials(
    db: Session = Depends(get_db),
    _user=Depends(require_role(["admin"])),
):
    rows = db.query(models.InventoryMaterial).filter(inventory_material_alive()).all()
    pmap = _sum_payments_map(db, [m.id for m in rows])
    acc: dict[str, tuple[Decimal, Decimal, Decimal]] = {}
    for m in rows:
        key = ((m.supplier_name or "").strip()) or "(no supplier)"
        paid = pmap.get(m.id, Decimal("0"))
        tc, tp, out = acc.get(key, (Decimal("0"), Decimal("0"), Decimal("0")))
        tp += paid
        c = _as_dec(m.cost)
        if c is not None:
            tc += c
            b = _display_balance(c, paid)
            if b is not None:
                out += b
        acc[key] = (tc, tp, out)
    out_rows = [
        InventorySupplierFinancialRow(
            supplier_name=name,
            total_cost=totals[0],
            total_paid=totals[1],
            outstanding=totals[2],
        )
        for name, totals in sorted(acc.items(), key=lambda x: x[0].lower())
    ]
    return out_rows


@router.get("/inventory/movements", response_model=list[InventoryMovementOut])
def list_movements(
    db: Session = Depends(get_db),
    _user=Depends(require_inventory_access),
    material_id: int | None = Query(None, ge=1),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    q = (
        db.query(models.InventoryMovement, models.InventoryMaterial.material_name)
        .join(
            models.InventoryMaterial,
            models.InventoryMaterial.id == models.InventoryMovement.material_id,
        )
        .filter(inventory_material_alive())
    )
    if material_id is not None:
        q = q.filter(models.InventoryMovement.material_id == material_id)
    q = q.order_by(models.InventoryMovement.id.desc()).offset(offset).limit(limit)
    out: list[InventoryMovementOut] = []
    for mov, mat_name in q.all():
        out.append(
            InventoryMovementOut(
                id=mov.id,
                material_id=mov.material_id,
                material_name=mat_name,
                action=mov.action,
                quantity_delta=mov.quantity_delta,
                meta=mov.meta,
                actor_username=mov.actor_username,
                created_at=mov.created_at,
            )
        )
    return out


@router.get("/inventory", response_model=list[InventoryMaterialOut])
def list_inventory(
    db: Session = Depends(get_db),
    _user=Depends(require_inventory_access),
    search: str | None = Query(None, max_length=200),
    stock_level: str | None = Query(None, pattern="^(low|medium|full)$"),
    supplier: str | None = Query(None, max_length=500),
    payment_status: str | None = Query(None, pattern="^(paid|partial|unpaid)$"),
):
    q = (
        db.query(models.InventoryMaterial)
        .filter(inventory_material_alive())
        .options(
            joinedload(models.InventoryMaterial.created_by_user),
            joinedload(models.InventoryMaterial.updated_by_user),
        )
        .order_by(models.InventoryMaterial.id.desc())
    )
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                models.InventoryMaterial.material_name.ilike(term),
                models.InventoryMaterial.supplier_name.ilike(term),
                models.InventoryMaterial.category.ilike(term),
            )
        )
    if stock_level:
        q = q.filter(models.InventoryMaterial.stock_level == stock_level)
    if supplier and supplier.strip():
        q = q.filter(models.InventoryMaterial.supplier_name.ilike(supplier.strip()))
    mats = q.all()
    ids = [m.id for m in mats]
    pmap = _sum_payments_map(db, ids)
    out: list[InventoryMaterialOut] = []
    for m in mats:
        paid = pmap.get(m.id, Decimal("0"))
        cost = _as_dec(m.cost)
        st = _derive_payment_status(cost, paid)
        if payment_status and st != payment_status:
            continue
        out.append(_material_to_out(m, amount_paid=paid))
    return out


@router.post("/inventory", response_model=InventoryMaterialOut)
def create_inventory(
    body: InventoryMaterialCreate,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    qty: Decimal | None
    if body.tracking_mode == "numeric":
        qty = body.quantity if body.quantity is not None else Decimal("0")
    else:
        qty = None

    row = models.InventoryMaterial(
        material_name=body.material_name.strip(),
        category=body.category,
        tracking_mode=body.tracking_mode,
        quantity=qty,
        unit=body.unit,
        stock_level=body.stock_level,
        supplier_name=(body.supplier_name or "").strip(),
        payment_status="unpaid",
        cost=body.cost,
        notes=body.notes,
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.add(row)
    db.flush()

    delta = qty if qty is not None else None
    _append_movement(
        db,
        material_id=row.id,
        action="added",
        quantity_delta=delta,
        meta=None if delta is not None else {"note": "status_only_tracking"},
        actor_user=user,
    )

    _sync_material_payment_status(db, row)
    log_activity(
        db,
        action=INVENTORY_MATERIAL_CREATED,
        entity_type="inventory_material",
        entity_id=row.id,
        actor_user=user,
        meta={"material_name": row.material_name},
    )
    db.commit()
    db.refresh(row)
    row = _get_alive(db, row.id, with_users=True)
    assert row is not None
    paid = _paid_for_material(db, row.id)
    return _material_to_out(row, amount_paid=paid)


@router.get("/inventory/{material_id}", response_model=InventoryMaterialDetailResponse)
def get_inventory_material_detail(
    material_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_inventory_access),
):
    row = _get_alive(db, material_id, with_users=True)
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")
    paid = _paid_for_material(db, material_id)
    tpurch, tused = _movement_quantity_stats(db, material_id)
    cur = _as_dec(row.quantity) if row.tracking_mode == "numeric" else None
    return InventoryMaterialDetailResponse(
        material=_material_to_out(row, amount_paid=paid),
        stats=InventoryMaterialQtyStats(
            total_quantity_purchased=tpurch,
            total_quantity_used=tused,
            current_quantity=cur,
        ),
    )


@router.put("/inventory/{material_id}", response_model=InventoryMaterialOut)
def update_inventory(
    material_id: int,
    body: InventoryMaterialUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    row = _get_alive(db, material_id, with_users=True)
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")

    data = body.model_dump(exclude_unset=True)
    if not data:
        paid0 = _paid_for_material(db, material_id)
        return _material_to_out(row, amount_paid=paid0)

    snap_qty = row.quantity
    snap_level = row.stock_level
    snap_mode = row.tracking_mode

    if "tracking_mode" in data:
        row.tracking_mode = data["tracking_mode"]
        if row.tracking_mode == "status_only":
            row.quantity = None
        elif row.tracking_mode == "numeric" and row.quantity is None:
            row.quantity = Decimal("0")

    if "material_name" in data:
        row.material_name = data["material_name"].strip()
    if "category" in data:
        row.category = data["category"]
    if "unit" in data:
        row.unit = data["unit"]
    if "supplier_name" in data:
        row.supplier_name = (data["supplier_name"] or "").strip()
    if "cost" in data:
        new_cost = data["cost"]
        paid_before = _paid_for_material(db, row.id)
        if new_cost is not None:
            nc = _as_dec(new_cost)
            if nc is not None and paid_before > nc:
                raise HTTPException(
                    status_code=400,
                    detail="Cost cannot be less than total payments already recorded for this material",
                )
        row.cost = new_cost
    if "notes" in data:
        row.notes = data["notes"]

    if "quantity" in data and row.tracking_mode == "numeric":
        qv = data["quantity"]
        if qv is not None:
            row.quantity = qv

    if "stock_level" in data:
        row.stock_level = data["stock_level"]

    row.updated_by_id = user.id
    row.updated_at = datetime.utcnow()

    if "quantity" in data and row.tracking_mode == "numeric":
        before = snap_qty if snap_mode == "numeric" and snap_qty is not None else Decimal("0")
        after = row.quantity if row.quantity is not None else Decimal("0")
        delta = after - before
        if delta != 0:
            _append_movement(
                db,
                material_id=row.id,
                action="adjusted",
                quantity_delta=delta,
                meta={"source": "field_update"},
                actor_user=user,
            )

    if "stock_level" in data and data["stock_level"] != snap_level:
        _append_movement(
            db,
            material_id=row.id,
            action="adjusted",
            quantity_delta=None,
            meta={
                "stock_level_before": snap_level,
                "stock_level_after": data["stock_level"],
                "source": "field_update",
            },
            actor_user=user,
        )

    _sync_material_payment_status(db, row)
    log_activity(
        db,
        action=INVENTORY_MATERIAL_UPDATED,
        entity_type="inventory_material",
        entity_id=row.id,
        actor_user=user,
        meta={"material_name": row.material_name},
    )
    db.commit()
    row = _get_alive(db, material_id, with_users=True)
    assert row is not None
    paid = _paid_for_material(db, row.id)
    return _material_to_out(row, amount_paid=paid)


@router.get("/inventory/{material_id}/payments", response_model=list[InventoryPaymentOut])
def list_material_payments(
    material_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    row = _get_alive(db, material_id, with_users=False)
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")
    q = (
        db.query(models.InventoryMaterialPayment)
        .filter(models.InventoryMaterialPayment.material_id == material_id)
        .options(joinedload(models.InventoryMaterialPayment.created_by_user))
        .order_by(models.InventoryMaterialPayment.paid_at.desc(), models.InventoryMaterialPayment.id.desc())
    )
    return [_payment_to_out(p) for p in q.all()]


@router.post("/inventory/{material_id}/payments", response_model=InventoryPaymentOut)
def record_material_payment(
    material_id: int,
    body: InventoryPaymentCreate,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    row = _get_alive(db, material_id, with_users=False)
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")
    paid_before = _paid_for_material(db, material_id)
    amt = body.amount
    cost = _as_dec(row.cost)
    if cost is not None and paid_before + amt > cost:
        raise HTTPException(
            status_code=400,
            detail="Total payments cannot exceed the material cost",
        )
    pay = models.InventoryMaterialPayment(
        material_id=material_id,
        amount=amt,
        paid_at=body.paid_at,
        note=body.note,
        created_by_id=user.id,
    )
    db.add(pay)
    db.flush()
    _sync_material_payment_status(db, row)
    row.updated_by_id = user.id
    row.updated_at = datetime.utcnow()
    log_activity(
        db,
        action=INVENTORY_PAYMENT_RECORDED,
        entity_type="inventory_material",
        entity_id=row.id,
        actor_user=user,
        meta={
            "material_name": row.material_name,
            "amount": str(amt),
            "paid_at": body.paid_at.isoformat(),
            "payment_id": pay.id,
        },
    )
    db.commit()
    db.refresh(pay)
    pay = (
        db.query(models.InventoryMaterialPayment)
        .filter(models.InventoryMaterialPayment.id == pay.id)
        .options(joinedload(models.InventoryMaterialPayment.created_by_user))
        .first()
    )
    assert pay is not None
    return _payment_to_out(pay)


@router.delete("/inventory/{material_id}/payments/{payment_id}")
def delete_material_payment(
    material_id: int,
    payment_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    row = _get_alive(db, material_id, with_users=False)
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")
    pay = (
        db.query(models.InventoryMaterialPayment)
        .filter(
            models.InventoryMaterialPayment.id == payment_id,
            models.InventoryMaterialPayment.material_id == material_id,
        )
        .first()
    )
    if not pay:
        raise HTTPException(status_code=404, detail="Payment not found")
    amt = pay.amount
    db.delete(pay)
    _sync_material_payment_status(db, row)
    row.updated_by_id = user.id
    row.updated_at = datetime.utcnow()
    log_activity(
        db,
        action=INVENTORY_PAYMENT_DELETED,
        entity_type="inventory_material",
        entity_id=row.id,
        actor_user=user,
        meta={
            "material_name": row.material_name,
            "amount": str(amt),
            "payment_id": payment_id,
        },
    )
    db.commit()
    return {"message": "Payment removed"}


@router.post("/inventory/{material_id}/movements", response_model=InventoryMovementOut)
def post_movement(
    material_id: int,
    body: InventoryMovementCreate,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    row = _get_alive(db, material_id, with_users=False)
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")
    if row.tracking_mode != "numeric":
        raise HTTPException(
            status_code=400,
            detail="Stock movements apply only to numeric tracking materials",
        )
    if row.quantity is None:
        row.quantity = Decimal("0")

    delta = body.quantity_delta
    new_qty = row.quantity + delta
    if new_qty < 0:
        raise HTTPException(status_code=400, detail="Quantity cannot go below zero")

    row.quantity = new_qty
    row.updated_by_id = user.id
    row.updated_at = datetime.utcnow()

    mov_meta: dict[str, Any] | None = None
    if body.note:
        mov_meta = {"note": body.note}

    mov = _append_movement(
        db,
        material_id=row.id,
        action=body.action,
        quantity_delta=delta,
        meta=mov_meta,
        actor_user=user,
    )
    log_activity(
        db,
        action=INVENTORY_MATERIAL_UPDATED,
        entity_type="inventory_material",
        entity_id=row.id,
        actor_user=user,
        meta={"material_name": row.material_name, "movement": body.action},
    )
    db.commit()
    db.refresh(mov)
    return InventoryMovementOut(
        id=mov.id,
        material_id=mov.material_id,
        material_name=row.material_name,
        action=mov.action,
        quantity_delta=mov.quantity_delta,
        meta=mov.meta,
        actor_username=mov.actor_username,
        created_at=mov.created_at,
    )


@router.post("/inventory/{material_id}/purchase", response_model=InventoryMaterialDetailResponse)
def post_inventory_purchase(
    material_id: int,
    body: InventoryStockPurchaseCreate,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    """Log a new inbound purchase: increases quantity, appends an `added` movement, and optionally adds to cumulative supplier cost."""
    row = _get_alive(db, material_id, with_users=False)
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")
    if row.tracking_mode != "numeric":
        raise HTTPException(
            status_code=400,
            detail="Purchases apply only to numeric tracking materials",
        )
    qty = body.quantity
    if row.quantity is None:
        row.quantity = Decimal("0")
    new_qty = row.quantity + qty
    row.quantity = new_qty

    meta: dict[str, Any] = {"kind": "purchase"}
    if body.purchase_amount is not None:
        meta["purchase_amount"] = str(body.purchase_amount)
    if body.note:
        meta["note"] = body.note

    _append_movement(
        db,
        material_id=row.id,
        action="added",
        quantity_delta=qty,
        meta=meta,
        actor_user=user,
    )
    if body.purchase_amount is not None and body.purchase_amount > 0:
        prev = _as_dec(row.cost) or Decimal("0")
        row.cost = prev + body.purchase_amount

    row.updated_by_id = user.id
    row.updated_at = datetime.utcnow()
    _sync_material_payment_status(db, row)
    log_activity(
        db,
        action=INVENTORY_MATERIAL_UPDATED,
        entity_type="inventory_material",
        entity_id=row.id,
        actor_user=user,
        meta={"material_name": row.material_name, "movement": "purchase"},
    )
    db.commit()
    row = _get_alive(db, material_id, with_users=True)
    assert row is not None
    paid = _paid_for_material(db, material_id)
    tpurch, tused = _movement_quantity_stats(db, material_id)
    cur = _as_dec(row.quantity) if row.tracking_mode == "numeric" else None
    return InventoryMaterialDetailResponse(
        material=_material_to_out(row, amount_paid=paid),
        stats=InventoryMaterialQtyStats(
            total_quantity_purchased=tpurch,
            total_quantity_used=tused,
            current_quantity=cur,
        ),
    )


@router.delete("/inventory/{material_id}")
def delete_inventory(
    material_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    row = _get_alive(db, material_id, with_users=False)
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")
    now = datetime.utcnow()
    row.deleted_at = now
    row.deleted_by_id = user.id
    row.updated_by_id = user.id
    row.updated_at = now
    log_activity(
        db,
        action=INVENTORY_MATERIAL_DELETED,
        entity_type="inventory_material",
        entity_id=row.id,
        actor_user=user,
        meta={"material_name": row.material_name},
    )
    db.commit()
    return {"message": "Moved to Trash"}


@router.post("/inventory/bulk-delete")
def bulk_delete_inventory(
    body: InventoryBulkDelete,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    now = datetime.utcnow()
    ids = sorted(set(body.ids))
    deleted: list[int] = []
    for mid in ids:
        row = _get_alive(db, mid, with_users=False)
        if not row:
            continue
        row.deleted_at = now
        row.deleted_by_id = user.id
        row.updated_by_id = user.id
        row.updated_at = now
        deleted.append(mid)
    if not deleted:
        raise HTTPException(status_code=404, detail="No matching materials")
    log_activity(
        db,
        action=INVENTORY_BULK_DELETED,
        entity_type="inventory_material",
        entity_id=None,
        actor_user=user,
        meta={"material_ids": deleted, "count": len(deleted)},
    )
    db.commit()
    return {"message": "Moved to Trash", "deleted_ids": deleted}


@router.post("/inventory/bulk-stock-level")
def bulk_stock_level(
    body: InventoryBulkStockLevel,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    now = datetime.utcnow()
    ids = sorted(set(body.ids))
    matched: list[int] = []
    for mid in ids:
        row = _get_alive(db, mid, with_users=False)
        if not row:
            continue
        matched.append(mid)
        prev = row.stock_level
        if prev == body.stock_level:
            continue
        row.stock_level = body.stock_level
        row.updated_by_id = user.id
        row.updated_at = now
        _append_movement(
            db,
            material_id=row.id,
            action="adjusted",
            quantity_delta=None,
            meta={
                "stock_level_before": prev,
                "stock_level_after": body.stock_level,
                "source": "bulk_update",
            },
            actor_user=user,
        )
    if not matched:
        raise HTTPException(status_code=404, detail="No matching materials")
    log_activity(
        db,
        action=INVENTORY_BULK_STOCK_LEVEL,
        entity_type="inventory_material",
        entity_id=None,
        actor_user=user,
        meta={"material_ids": matched, "stock_level": body.stock_level},
    )
    db.commit()
    return {"message": "Updated", "updated_ids": matched}


@router.post("/inventory/bulk-update")
def bulk_patch_inventory(
    body: InventoryBulkPatch,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    now = datetime.utcnow()
    ids = sorted(set(body.ids))
    patch = body.model_dump(exclude={"ids"}, exclude_unset=True)
    updated: list[int] = []
    for mid in ids:
        row = _get_alive(db, mid, with_users=False)
        if not row:
            continue
        changed = False
        if "stock_level" in patch and patch["stock_level"] is not None:
            prev = row.stock_level
            if prev != patch["stock_level"]:
                row.stock_level = patch["stock_level"]
                _append_movement(
                    db,
                    material_id=row.id,
                    action="adjusted",
                    quantity_delta=None,
                    meta={
                        "stock_level_before": prev,
                        "stock_level_after": patch["stock_level"],
                        "source": "bulk_edit",
                    },
                    actor_user=user,
                )
                changed = True
        if "supplier_name" in patch and patch["supplier_name"] is not None:
            nv = patch["supplier_name"].strip()
            if row.supplier_name != nv:
                row.supplier_name = nv
                changed = True
        if "category" in patch:
            if row.category != patch["category"]:
                row.category = patch["category"]
                changed = True
        if changed:
            row.updated_by_id = user.id
            row.updated_at = now
            updated.append(mid)
    if not updated:
        raise HTTPException(status_code=404, detail="No matching materials or no changes")
    log_activity(
        db,
        action=INVENTORY_BULK_UPDATED,
        entity_type="inventory_material",
        entity_id=None,
        actor_user=user,
        meta={"material_ids": updated},
    )
    db.commit()
    return {"message": "Updated", "updated_ids": updated}
