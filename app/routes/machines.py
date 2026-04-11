"""Factory machines: catalog, status, and activity log (similar to inventory materials)."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app import models
from app.database import get_db
from app.routes.inventory import require_inventory_access
from app.schemas import (
    FactoryMachineCreate,
    FactoryMachineDetailResponse,
    FactoryMachineOut,
    FactoryMachineUpdate,
    MachineActivityCreate,
    MachineActivityOut,
)
from app.utils.activity_log import log_activity, username_from_email

router = APIRouter(prefix="/machines", tags=["Machines"])

_VALID_STATUS = frozenset({"available", "in_use", "maintenance"})


def _machine_alive(db: Session, machine_id: int) -> models.FactoryMachine | None:
    return (
        db.query(models.FactoryMachine)
        .filter(
            models.FactoryMachine.id == machine_id,
            models.FactoryMachine.deleted_at.is_(None),
        )
        .first()
    )


def _machine_to_out(m: models.FactoryMachine) -> FactoryMachineOut:
    st = m.status if m.status in _VALID_STATUS else "available"
    return FactoryMachineOut(
        id=m.id,
        machine_name=m.machine_name,
        category=m.category,
        serial_number=m.serial_number,
        location=m.location,
        status=st,  # type: ignore[arg-type]
        notes=m.notes,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


def _activity_to_out(a: models.MachineActivity) -> MachineActivityOut:
    kind = a.kind if a.kind in ("usage_start", "usage_end", "status_change", "note") else "note"
    return MachineActivityOut(
        id=a.id,
        machine_id=a.machine_id,
        kind=kind,  # type: ignore[arg-type]
        message=a.message,
        meta=a.meta,
        created_at=a.created_at,
        recorded_by=username_from_email(getattr(getattr(a, "created_by_user", None), "email", None)),
    )


def _append_activity(
    db: Session,
    *,
    machine_id: int,
    kind: str,
    message: str | None,
    meta: dict[str, Any] | None,
    user,
) -> models.MachineActivity:
    row = models.MachineActivity(
        machine_id=machine_id,
        kind=kind,
        message=message,
        meta=meta,
        created_by_id=getattr(user, "id", None),
    )
    db.add(row)
    return row


@router.get("", response_model=list[FactoryMachineOut])
def list_machines(
    search: str | None = Query(None, max_length=200),
    status: str | None = Query(None, pattern="^(available|in_use|maintenance)$"),
    db: Session = Depends(get_db),
    _user=Depends(require_inventory_access),
):
    q = db.query(models.FactoryMachine).filter(models.FactoryMachine.deleted_at.is_(None))
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(models.FactoryMachine.machine_name.ilike(term))
    if status:
        q = q.filter(models.FactoryMachine.status == status)
    rows = q.order_by(models.FactoryMachine.machine_name.asc()).all()
    return [_machine_to_out(m) for m in rows]


@router.post("", response_model=FactoryMachineOut)
def create_machine(
    body: FactoryMachineCreate,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    if body.status not in _VALID_STATUS:
        raise HTTPException(status_code=400, detail="Invalid status")
    row = models.FactoryMachine(
        machine_name=body.machine_name.strip(),
        category=(body.category or "").strip() or None,
        serial_number=(body.serial_number or "").strip() or None,
        location=(body.location or "").strip() or None,
        status=body.status,
        notes=(body.notes or "").strip() or None,
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.add(row)
    db.flush()
    _append_activity(
        db,
        machine_id=row.id,
        kind="note",
        message="Machine registered",
        meta={"initial_status": row.status},
        user=user,
    )
    log_activity(
        db,
        action="Machine Created",
        entity_type="factory_machine",
        entity_id=row.id,
        actor_user=user,
        meta={"machine_name": row.machine_name},
    )
    db.commit()
    db.refresh(row)
    return _machine_to_out(row)


@router.get("/{machine_id}", response_model=FactoryMachineDetailResponse)
def get_machine_detail(
    machine_id: int,
    activity_limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _user=Depends(require_inventory_access),
):
    m = _machine_alive(db, machine_id)
    if not m:
        raise HTTPException(status_code=404, detail="Machine not found")
    acts = (
        db.query(models.MachineActivity)
        .options(joinedload(models.MachineActivity.created_by_user))
        .filter(models.MachineActivity.machine_id == machine_id)
        .order_by(models.MachineActivity.created_at.desc())
        .limit(activity_limit)
        .all()
    )
    return FactoryMachineDetailResponse(machine=_machine_to_out(m), activities=[_activity_to_out(a) for a in acts])


@router.put("/{machine_id}", response_model=FactoryMachineOut)
def update_machine(
    machine_id: int,
    body: FactoryMachineUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    row = _machine_alive(db, machine_id)
    if not row:
        raise HTTPException(status_code=404, detail="Machine not found")
    data = body.model_dump(exclude_unset=True)
    if not data:
        return _machine_to_out(row)

    before_status = row.status
    if "machine_name" in data and data["machine_name"] is not None:
        row.machine_name = str(data["machine_name"]).strip()
    if "category" in data:
        row.category = (str(data["category"]).strip() if data["category"] else None) or None
    if "serial_number" in data:
        row.serial_number = (str(data["serial_number"]).strip() if data["serial_number"] else None) or None
    if "location" in data:
        row.location = (str(data["location"]).strip() if data["location"] else None) or None
    if "notes" in data:
        row.notes = (str(data["notes"]).strip() if data["notes"] else None) or None
    if "status" in data and data["status"] is not None:
        if data["status"] not in _VALID_STATUS:
            raise HTTPException(status_code=400, detail="Invalid status")
        row.status = data["status"]

    row.updated_by_id = user.id
    row.updated_at = datetime.utcnow()

    if "status" in data and data["status"] is not None and data["status"] != before_status:
        _append_activity(
            db,
            machine_id=row.id,
            kind="status_change",
            message=None,
            meta={"from": before_status, "to": row.status, "source": "field_update"},
            user=user,
        )

    log_activity(
        db,
        action="Machine Updated",
        entity_type="factory_machine",
        entity_id=row.id,
        actor_user=user,
        meta={"machine_name": row.machine_name},
    )
    db.commit()
    db.refresh(row)
    return _machine_to_out(row)


@router.delete("/{machine_id}")
def delete_machine(
    machine_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    row = _machine_alive(db, machine_id)
    if not row:
        raise HTTPException(status_code=404, detail="Machine not found")
    row.deleted_at = datetime.utcnow()
    row.deleted_by_id = user.id
    log_activity(
        db,
        action="Machine Deleted",
        entity_type="factory_machine",
        entity_id=machine_id,
        actor_user=user,
        meta={"machine_name": row.machine_name},
    )
    db.commit()
    return {"message": "Machine deleted"}


@router.post("/{machine_id}/activities", response_model=MachineActivityOut)
def post_machine_activity(
    machine_id: int,
    body: MachineActivityCreate,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    m = _machine_alive(db, machine_id)
    if not m:
        raise HTTPException(status_code=404, detail="Machine not found")

    msg = (body.message or "").strip() or None
    meta: dict[str, Any] = {}
    new_status: str | None = None

    if body.kind == "note":
        row = _append_activity(db, machine_id=machine_id, kind="note", message=msg, meta=None, user=user)
    elif body.kind == "status_change":
        assert body.new_status is not None
        new_status = body.new_status
        meta = {"from": m.status, "to": new_status}
        m.status = new_status
        m.updated_by_id = user.id
        m.updated_at = datetime.utcnow()
        row = _append_activity(
            db, machine_id=machine_id, kind="status_change", message=msg, meta=meta, user=user
        )
    elif body.kind == "usage_start":
        meta = {"from": m.status}
        m.status = "in_use"
        m.updated_by_id = user.id
        m.updated_at = datetime.utcnow()
        row = _append_activity(
            db,
            machine_id=machine_id,
            kind="usage_start",
            message=msg or "Usage started",
            meta=meta,
            user=user,
        )
    elif body.kind == "usage_end":
        meta = {"from": m.status}
        m.status = "available"
        m.updated_by_id = user.id
        m.updated_at = datetime.utcnow()
        row = _append_activity(
            db,
            machine_id=machine_id,
            kind="usage_end",
            message=msg or "Usage ended",
            meta=meta,
            user=user,
        )
    else:
        raise HTTPException(status_code=400, detail="Unsupported activity kind")

    log_activity(
        db,
        action="Machine Activity",
        entity_type="factory_machine",
        entity_id=machine_id,
        actor_user=user,
        meta={"kind": body.kind, "machine_name": m.machine_name},
    )
    db.commit()
    db.refresh(row)
    row = (
        db.query(models.MachineActivity)
        .options(joinedload(models.MachineActivity.created_by_user))
        .filter(models.MachineActivity.id == row.id)
        .first()
    )
    assert row is not None
    return _activity_to_out(row)
