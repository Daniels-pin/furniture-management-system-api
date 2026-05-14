"""Trash (soft-delete) listing, restore, and admin purge."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import normalize_role, reject_staff, require_role
from app.database import get_db
from app.utils.activity_log import TRASH_PURGED, TRASH_RESTORED, log_activity, username_from_email

router = APIRouter(prefix="/trash", tags=["Trash"])

ENTITY_TYPES: frozenset[str] = frozenset(
    (
        "order",
        "customer",
        "invoice",
        "product",
        "proforma",
        "quotation",
        "waybill",
        "inventory_material",
        "factory_tool",
        "factory_machine",
    )
)

# Lower runs first — reduces FK failures when purging everything in trash.
_PURGE_ORDER: dict[str, int] = {
    "factory_tool": 10,
    "factory_machine": 20,
    "inventory_material": 30,
    "product": 40,
    "proforma": 50,
    "quotation": 60,
    "waybill": 70,
    "invoice": 80,
    "order": 90,
    "customer": 100,
}


class TrashRow(BaseModel):
    entity_type: str
    entity_id: int
    deleted_at: datetime
    deleted_by_id: int
    deleted_by_username: str | None = None
    label: str


class TrashListResponse(BaseModel):
    items: list[TrashRow]


class TrashRestoreRequest(BaseModel):
    entity_type: str = Field(..., min_length=2)
    entity_id: int = Field(..., ge=1)


class TrashPurgeItem(BaseModel):
    entity_type: str = Field(..., min_length=2)
    entity_id: int = Field(..., ge=1)


class TrashPurgeBulkRequest(BaseModel):
    items: list[TrashPurgeItem] = Field(..., max_length=500)


class TrashPurgeBulkResponse(BaseModel):
    purged: int
    failed: list[dict[str, Any]]


class TrashPurgeAllRequest(BaseModel):
    confirm: Literal["PERMANENTLY_DELETE_ALL_TRASH"]


class TrashPurgeAllResponse(BaseModel):
    purged: int
    failed: list[dict[str, Any]]


def _actor_label(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    u = db.query(models.User).filter(models.User.id == user_id).first()
    return username_from_email(getattr(u, "email", None)) if u else None


def _can_see_row(is_admin: bool, actor_id: int | None, user_id: int) -> bool:
    if is_admin:
        return True
    return actor_id == user_id


def _sync_invoice_soft_delete(db: Session, order: models.Order, when: datetime, by_id: int) -> None:
    inv = db.query(models.Invoice).filter(models.Invoice.order_id == order.id).first()
    if inv:
        inv.deleted_at = when
        inv.deleted_by_id = by_id


def _sync_invoice_restore(db: Session, order: models.Order) -> None:
    inv = db.query(models.Invoice).filter(models.Invoice.order_id == order.id).first()
    if inv:
        inv.deleted_at = None
        inv.deleted_by_id = None


def _gather_trash_rows(db: Session, is_admin: bool, uid: int) -> list[TrashRow]:
    rows: list[TrashRow] = []
    trashed_order_ids: set[int] = set()

    for o in (
        db.query(models.Order)
        .filter(models.Order.deleted_at.isnot(None))
        .order_by(models.Order.deleted_at.desc())
        .all()
    ):
        if not _can_see_row(is_admin, o.deleted_by_id, uid):
            continue
        trashed_order_ids.add(o.id)
        rows.append(
            TrashRow(
                entity_type="order",
                entity_id=o.id,
                deleted_at=o.deleted_at,
                deleted_by_id=o.deleted_by_id or 0,
                deleted_by_username=_actor_label(db, o.deleted_by_id),
                label=f"Order #{o.id}",
            )
        )

    for inv in (
        db.query(models.Invoice)
        .filter(models.Invoice.deleted_at.isnot(None))
        .order_by(models.Invoice.deleted_at.desc())
        .all()
    ):
        if inv.order_id in trashed_order_ids:
            continue
        if not _can_see_row(is_admin, inv.deleted_by_id, uid):
            continue
        rows.append(
            TrashRow(
                entity_type="invoice",
                entity_id=inv.id,
                deleted_at=inv.deleted_at,
                deleted_by_id=inv.deleted_by_id or 0,
                deleted_by_username=_actor_label(db, inv.deleted_by_id),
                label=f"Invoice {inv.invoice_number}",
            )
        )

    for c in (
        db.query(models.Customer)
        .filter(models.Customer.deleted_at.isnot(None))
        .order_by(models.Customer.deleted_at.desc())
        .all()
    ):
        if not _can_see_row(is_admin, c.deleted_by_id, uid):
            continue
        rows.append(
            TrashRow(
                entity_type="customer",
                entity_id=c.id,
                deleted_at=c.deleted_at,
                deleted_by_id=c.deleted_by_id or 0,
                deleted_by_username=_actor_label(db, c.deleted_by_id),
                label=f"Customer: {c.name or c.id}",
            )
        )

    for p in (
        db.query(models.Product)
        .filter(models.Product.deleted_at.isnot(None))
        .order_by(models.Product.deleted_at.desc())
        .all()
    ):
        if not _can_see_row(is_admin, p.deleted_by_id, uid):
            continue
        rows.append(
            TrashRow(
                entity_type="product",
                entity_id=p.id,
                deleted_at=p.deleted_at,
                deleted_by_id=p.deleted_by_id or 0,
                deleted_by_username=_actor_label(db, p.deleted_by_id),
                label=f"Product: {p.name or p.id}",
            )
        )

    for pf in (
        db.query(models.ProformaInvoice)
        .filter(models.ProformaInvoice.deleted_at.isnot(None))
        .order_by(models.ProformaInvoice.deleted_at.desc())
        .all()
    ):
        if not _can_see_row(is_admin, pf.deleted_by_id, uid):
            continue
        rows.append(
            TrashRow(
                entity_type="proforma",
                entity_id=pf.id,
                deleted_at=pf.deleted_at,
                deleted_by_id=pf.deleted_by_id or 0,
                deleted_by_username=_actor_label(db, pf.deleted_by_id),
                label=f"Proforma {pf.proforma_number}",
            )
        )

    for q in (
        db.query(models.Quotation)
        .filter(models.Quotation.deleted_at.isnot(None))
        .order_by(models.Quotation.deleted_at.desc())
        .all()
    ):
        if not _can_see_row(is_admin, q.deleted_by_id, uid):
            continue
        rows.append(
            TrashRow(
                entity_type="quotation",
                entity_id=q.id,
                deleted_at=q.deleted_at,
                deleted_by_id=q.deleted_by_id or 0,
                deleted_by_username=_actor_label(db, q.deleted_by_id),
                label=f"Quotation {q.quote_number}",
            )
        )

    for wb in (
        db.query(models.Waybill)
        .filter(models.Waybill.deleted_at.isnot(None))
        .order_by(models.Waybill.deleted_at.desc())
        .all()
    ):
        if not _can_see_row(is_admin, wb.deleted_by_id, uid):
            continue
        rows.append(
            TrashRow(
                entity_type="waybill",
                entity_id=wb.id,
                deleted_at=wb.deleted_at,
                deleted_by_id=wb.deleted_by_id or 0,
                deleted_by_username=_actor_label(db, wb.deleted_by_id),
                label=f"Waybill {wb.waybill_number}",
            )
        )

    for invm in (
        db.query(models.InventoryMaterial)
        .filter(models.InventoryMaterial.deleted_at.isnot(None))
        .order_by(models.InventoryMaterial.deleted_at.desc())
        .all()
    ):
        if not _can_see_row(is_admin, invm.deleted_by_id, uid):
            continue
        rows.append(
            TrashRow(
                entity_type="inventory_material",
                entity_id=invm.id,
                deleted_at=invm.deleted_at,
                deleted_by_id=invm.deleted_by_id or 0,
                deleted_by_username=_actor_label(db, invm.deleted_by_id),
                label=f"Inventory: {invm.material_name or invm.id}",
            )
        )

    for ft in (
        db.query(models.FactoryTool)
        .filter(models.FactoryTool.deleted_at.isnot(None))
        .order_by(models.FactoryTool.deleted_at.desc())
        .all()
    ):
        if not _can_see_row(is_admin, ft.deleted_by_id, uid):
            continue
        rows.append(
            TrashRow(
                entity_type="factory_tool",
                entity_id=ft.id,
                deleted_at=ft.deleted_at,
                deleted_by_id=ft.deleted_by_id or 0,
                deleted_by_username=_actor_label(db, ft.deleted_by_id),
                label=f"Tool: {ft.name or ft.id}",
            )
        )

    for fm in (
        db.query(models.FactoryMachine)
        .filter(models.FactoryMachine.deleted_at.isnot(None))
        .order_by(models.FactoryMachine.deleted_at.desc())
        .all()
    ):
        if not _can_see_row(is_admin, fm.deleted_by_id, uid):
            continue
        rows.append(
            TrashRow(
                entity_type="factory_machine",
                entity_id=fm.id,
                deleted_at=fm.deleted_at,
                deleted_by_id=fm.deleted_by_id or 0,
                deleted_by_username=_actor_label(db, fm.deleted_by_id),
                label=f"Machine: {fm.machine_name or fm.id}",
            )
        )

    return rows


@router.get("", response_model=TrashListResponse)
def list_trash(
    db: Session = Depends(get_db),
    user=Depends(reject_staff),
):
    is_admin = normalize_role(user.role) == "admin"
    rows = _gather_trash_rows(db, is_admin, user.id)
    rows.sort(key=lambda r: r.deleted_at, reverse=True)
    return TrashListResponse(items=rows)


def _load_trashed_entity(
    db: Session, entity_type: str, entity_id: int
) -> tuple[str, Any]:
    if entity_type == "order":
        o = db.query(models.Order).filter(models.Order.id == entity_id).first()
        if not o or o.deleted_at is None:
            raise HTTPException(status_code=404, detail="Not in trash")
        return "order", o
    if entity_type == "invoice":
        inv = db.query(models.Invoice).filter(models.Invoice.id == entity_id).first()
        if not inv or inv.deleted_at is None:
            raise HTTPException(status_code=404, detail="Not in trash")
        return "invoice", inv
    if entity_type == "customer":
        c = db.query(models.Customer).filter(models.Customer.id == entity_id).first()
        if not c or c.deleted_at is None:
            raise HTTPException(status_code=404, detail="Not in trash")
        return "customer", c
    if entity_type == "product":
        p = db.query(models.Product).filter(models.Product.id == entity_id).first()
        if not p or p.deleted_at is None:
            raise HTTPException(status_code=404, detail="Not in trash")
        return "product", p
    if entity_type == "proforma":
        pf = db.query(models.ProformaInvoice).filter(models.ProformaInvoice.id == entity_id).first()
        if not pf or pf.deleted_at is None:
            raise HTTPException(status_code=404, detail="Not in trash")
        return "proforma", pf
    if entity_type == "quotation":
        q = db.query(models.Quotation).filter(models.Quotation.id == entity_id).first()
        if not q or q.deleted_at is None:
            raise HTTPException(status_code=404, detail="Not in trash")
        return "quotation", q
    if entity_type == "waybill":
        wb = db.query(models.Waybill).filter(models.Waybill.id == entity_id).first()
        if not wb or wb.deleted_at is None:
            raise HTTPException(status_code=404, detail="Not in trash")
        return "waybill", wb
    if entity_type == "inventory_material":
        invm = db.query(models.InventoryMaterial).filter(models.InventoryMaterial.id == entity_id).first()
        if not invm or invm.deleted_at is None:
            raise HTTPException(status_code=404, detail="Not in trash")
        return "inventory_material", invm
    if entity_type == "factory_tool":
        ft = db.query(models.FactoryTool).filter(models.FactoryTool.id == entity_id).first()
        if not ft or ft.deleted_at is None:
            raise HTTPException(status_code=404, detail="Not in trash")
        return "factory_tool", ft
    if entity_type == "factory_machine":
        fm = db.query(models.FactoryMachine).filter(models.FactoryMachine.id == entity_id).first()
        if not fm or fm.deleted_at is None:
            raise HTTPException(status_code=404, detail="Not in trash")
        return "factory_machine", fm
    raise HTTPException(status_code=400, detail="Invalid entity_type")


def _purge_prepare_delete(db: Session, entity_type: str, entity: Any) -> dict[str, Any]:
    meta: dict[str, Any] = {"entity_type": entity_type, "entity_id": entity.id}
    if entity_type == "order":
        meta["order_id"] = entity.id
        db.delete(entity)
    elif entity_type == "invoice":
        meta["invoice_id"] = entity.id
        db.delete(entity)
    elif entity_type == "customer":
        db.delete(entity)
    elif entity_type == "product":
        db.delete(entity)
    elif entity_type == "proforma":
        db.delete(entity)
    elif entity_type == "quotation":
        db.delete(entity)
    elif entity_type == "waybill":
        db.delete(entity)
    elif entity_type == "inventory_material":
        db.delete(entity)
    elif entity_type == "factory_tool":
        db.delete(entity)
    elif entity_type == "factory_machine":
        db.delete(entity)
    return meta


def _purge_one(db: Session, entity_type: str, entity_id: int, user) -> None:
    if entity_type not in ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid entity_type")
    _et, entity = _load_trashed_entity(db, entity_type, entity_id)
    meta = _purge_prepare_delete(db, entity_type, entity)
    log_activity(
        db,
        action=TRASH_PURGED,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_user=user,
        meta=meta,
    )


def _commit_purge(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Cannot purge: other records still reference this item. Purge or restore linked data first.",
        )


@router.post("/restore")
def restore_item(
    body: TrashRestoreRequest,
    db: Session = Depends(get_db),
    user=Depends(reject_staff),
):
    if body.entity_type not in ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid entity_type")

    _et, entity = _load_trashed_entity(db, body.entity_type, body.entity_id)
    is_admin = normalize_role(user.role) == "admin"
    deleted_by = getattr(entity, "deleted_by_id", None)
    if not is_admin and deleted_by != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if body.entity_type == "order":
        order = entity
        order.deleted_at = None
        order.deleted_by_id = None
        _sync_invoice_restore(db, order)
    elif body.entity_type == "invoice":
        inv = entity
        ord_ = db.query(models.Order).filter(models.Order.id == inv.order_id).first()
        if ord_ and ord_.deleted_at is not None:
            raise HTTPException(
                status_code=400,
                detail="Restore the order from Trash first; its invoice is linked to a deleted order.",
            )
        inv.deleted_at = None
        inv.deleted_by_id = None
    else:
        entity.deleted_at = None
        entity.deleted_by_id = None

    log_activity(
        db,
        action=TRASH_RESTORED,
        entity_type=body.entity_type,
        entity_id=body.entity_id,
        actor_user=user,
    )
    db.commit()
    return {"message": "Restored"}


@router.post("/purge")
def purge_item_post(
    body: TrashPurgeItem,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    """Permanently delete one trashed row (POST avoids DELETE being blocked by some proxies)."""
    _purge_one(db, body.entity_type, body.entity_id, user)
    _commit_purge(db)
    return {"message": "Permanently deleted"}


@router.delete("/purge/{entity_type}/{entity_id}")
def purge_item(
    entity_type: str,
    entity_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    _purge_one(db, entity_type, entity_id, user)
    _commit_purge(db)
    return {"message": "Permanently deleted"}


@router.post("/purge-bulk", response_model=TrashPurgeBulkResponse)
def purge_bulk(
    body: TrashPurgeBulkRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    purged = 0
    failed: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for item in body.items:
        key = (item.entity_type, item.entity_id)
        if key in seen:
            continue
        seen.add(key)
        if item.entity_type not in ENTITY_TYPES:
            failed.append(
                {"entity_type": item.entity_type, "entity_id": item.entity_id, "detail": "Invalid entity_type"}
            )
            continue
        try:
            _purge_one(db, item.entity_type, item.entity_id, user)
            _commit_purge(db)
            purged += 1
        except HTTPException as e:
            db.rollback()
            failed.append(
                {
                    "entity_type": item.entity_type,
                    "entity_id": item.entity_id,
                    "detail": e.detail if isinstance(e.detail, str) else str(e.detail),
                }
            )
        except IntegrityError:
            db.rollback()
            failed.append(
                {
                    "entity_type": item.entity_type,
                    "entity_id": item.entity_id,
                    "detail": "Database constraint: referenced by another row",
                }
            )
    return TrashPurgeBulkResponse(purged=purged, failed=failed)


@router.post("/purge-all", response_model=TrashPurgeAllResponse)
def purge_all(
    body: TrashPurgeAllRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    rows = _gather_trash_rows(db, True, user.id)
    rows.sort(
        key=lambda r: (_PURGE_ORDER.get(r.entity_type, 999), r.deleted_at, r.entity_type, r.entity_id),
    )
    purged = 0
    failed: list[dict[str, Any]] = []
    for r in rows:
        try:
            _purge_one(db, r.entity_type, r.entity_id, user)
            _commit_purge(db)
            purged += 1
        except HTTPException as e:
            db.rollback()
            failed.append(
                {
                    "entity_type": r.entity_type,
                    "entity_id": r.entity_id,
                    "label": r.label,
                    "detail": e.detail if isinstance(e.detail, str) else str(e.detail),
                }
            )
        except IntegrityError:
            db.rollback()
            failed.append(
                {
                    "entity_type": r.entity_type,
                    "entity_id": r.entity_id,
                    "label": r.label,
                    "detail": "Database constraint: referenced by another row",
                }
            )
    return TrashPurgeAllResponse(purged=purged, failed=failed)
