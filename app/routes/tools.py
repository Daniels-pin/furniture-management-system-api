"""Factory tool catalog and daily check-out / return tracking."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app import models
from app.database import get_db
from app.routes.inventory import require_inventory_access
from app.schemas import (
    FactoryToolCreate,
    FactoryToolDetailResponse,
    FactoryToolOut,
    FactoryToolUpdate,
    ToolTrackingCheckoutCreate,
    ToolTrackingDaySummary,
    ToolTrackingDaysPage,
    ToolTrackingRecordOut,
    ToolTrackingRecordsPage,
    ToolTrackingReturnBody,
)
from app.utils.activity_log import log_activity, username_from_email

router = APIRouter(prefix="/tools", tags=["Tools"])


def _tool_alive(db: Session, tool_id: int) -> models.FactoryTool | None:
    return (
        db.query(models.FactoryTool)
        .filter(
            models.FactoryTool.id == tool_id,
            models.FactoryTool.deleted_at.is_(None),
        )
        .first()
    )


def _open_record_for_tool(db: Session, tool_id: int) -> models.ToolTrackingRecord | None:
    return (
        db.query(models.ToolTrackingRecord)
        .filter(
            models.ToolTrackingRecord.tool_id == tool_id,
            models.ToolTrackingRecord.returned_at.is_(None),
        )
        .first()
    )


def _tool_to_out(db: Session, t: models.FactoryTool) -> FactoryToolOut:
    in_use = _open_record_for_tool(db, t.id) is not None
    return FactoryToolOut(
        id=t.id,
        name=t.name,
        notes=t.notes,
        in_use=in_use,
        created_at=t.created_at,
    )


def _record_to_out(rec: models.ToolTrackingRecord) -> ToolTrackingRecordOut:
    tool = rec.tool
    return ToolTrackingRecordOut(
        id=rec.id,
        tool_id=rec.tool_id,
        tool_name=tool.name if tool else "",
        checkout_at=rec.checkout_at,
        returned_at=rec.returned_at,
        borrower_name=rec.borrower_name,
        notes=rec.notes,
        checked_out_by=username_from_email(
            getattr(getattr(rec, "created_by_user", None), "email", None)
        ),
    )


@router.get("", response_model=list[FactoryToolOut])
def list_tools(
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    rows = (
        db.query(models.FactoryTool)
        .filter(models.FactoryTool.deleted_at.is_(None))
        .order_by(models.FactoryTool.name.asc())
        .all()
    )
    return [_tool_to_out(db, t) for t in rows]


@router.post("", response_model=FactoryToolOut)
def create_tool(
    body: FactoryToolCreate,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    row = models.FactoryTool(
        name=body.name.strip(),
        notes=(body.notes or "").strip() or None,
        created_by_id=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    log_activity(
        db,
        action="Tool Created",
        entity_type="factory_tool",
        entity_id=row.id,
        actor_user=user,
        meta={"name": row.name},
    )
    db.commit()
    return _tool_to_out(db, row)


@router.put("/{tool_id}", response_model=FactoryToolOut)
def update_tool(
    tool_id: int,
    body: FactoryToolUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    row = _tool_alive(db, tool_id)
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")
    data = body.model_dump(exclude_unset=True)
    if not data:
        return _tool_to_out(db, row)
    if "name" in data and data["name"] is not None:
        row.name = str(data["name"]).strip()
    if "notes" in data:
        row.notes = (str(data["notes"]).strip() if data["notes"] is not None else None) or None
    db.commit()
    db.refresh(row)
    log_activity(
        db,
        action="Tool Updated",
        entity_type="factory_tool",
        entity_id=row.id,
        actor_user=user,
        meta={"name": row.name},
    )
    db.commit()
    return _tool_to_out(db, row)


@router.delete("/{tool_id}")
def delete_tool(
    tool_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    row = _tool_alive(db, tool_id)
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")
    if _open_record_for_tool(db, tool_id):
        raise HTTPException(status_code=400, detail="Cannot delete a tool that is currently checked out")
    row.deleted_at = datetime.utcnow()
    row.deleted_by_id = user.id
    db.commit()
    log_activity(
        db,
        action="Tool Deleted",
        entity_type="factory_tool",
        entity_id=tool_id,
        actor_user=user,
        meta={"name": row.name},
    )
    db.commit()
    return {"message": "Tool deleted"}


@router.get("/tracking/days", response_model=ToolTrackingDaysPage)
def list_tracking_days(
    page: int = Query(1, ge=1),
    per_page: int = Query(14, ge=1, le=90),
    db: Session = Depends(get_db),
    _user=Depends(require_inventory_access),
):
    day_col = func.date(models.ToolTrackingRecord.checkout_at)
    total_days = int(
        db.query(func.count())
        .select_from(db.query(day_col.label("d")).distinct().subquery())
        .scalar()
        or 0
    )

    offset = (page - 1) * per_page
    day_rows = (
        db.query(day_col.label("d"))
        .group_by(day_col)
        .order_by(day_col.desc())
        .offset(offset)
        .limit(per_page)
        .all()
    )

    items: list[ToolTrackingDaySummary] = []
    for (dval,) in day_rows:
        if dval is None:
            continue
        day_str = dval.isoformat() if hasattr(dval, "isoformat") else str(dval)
        if not day_str:
            continue
        base = db.query(models.ToolTrackingRecord).filter(day_col == day_str)
        checkouts = int(base.count())
        still_out = int(base.filter(models.ToolTrackingRecord.returned_at.is_(None)).count())
        items.append(ToolTrackingDaySummary(date=day_str, checkouts=checkouts, still_out=still_out))

    return ToolTrackingDaysPage(items=items, page=page, per_page=per_page, total_days=total_days)


@router.get("/tracking/by-day", response_model=ToolTrackingRecordsPage)
def list_tracking_for_day(
    date: str = Query(..., min_length=10, max_length=10, description="YYYY-MM-DD"),
    status: str = Query("all", pattern="^(all|returned|in_use)$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _user=Depends(require_inventory_access),
):
    day_col = func.date(models.ToolTrackingRecord.checkout_at)
    q = (
        db.query(models.ToolTrackingRecord)
        .options(joinedload(models.ToolTrackingRecord.tool), joinedload(models.ToolTrackingRecord.created_by_user))
        .filter(day_col == date)
    )
    if status == "returned":
        q = q.filter(models.ToolTrackingRecord.returned_at.isnot(None))
    elif status == "in_use":
        q = q.filter(models.ToolTrackingRecord.returned_at.is_(None))

    total = int(q.count())
    rows = (
        q.order_by(models.ToolTrackingRecord.checkout_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    sf: str = status if status in ("all", "returned", "in_use") else "all"
    return ToolTrackingRecordsPage(
        date=date,
        status_filter=sf,  # type: ignore[arg-type]
        items=[_record_to_out(r) for r in rows],
        page=page,
        per_page=per_page,
        total=total,
    )


@router.post("/tracking/checkout", response_model=ToolTrackingRecordOut)
def checkout_tool(
    body: ToolTrackingCheckoutCreate,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    tool = _tool_alive(db, body.tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    if _open_record_for_tool(db, body.tool_id):
        raise HTTPException(status_code=400, detail="This tool is already checked out")

    checkout_at = body.checkout_at or datetime.utcnow()
    rec = models.ToolTrackingRecord(
        tool_id=body.tool_id,
        checkout_at=checkout_at,
        borrower_name=(body.borrower_name or "").strip() or None,
        notes=(body.notes or "").strip() or None,
        created_by_id=user.id,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    rec = (
        db.query(models.ToolTrackingRecord)
        .options(joinedload(models.ToolTrackingRecord.tool), joinedload(models.ToolTrackingRecord.created_by_user))
        .filter(models.ToolTrackingRecord.id == rec.id)
        .first()
    )
    assert rec is not None
    log_activity(
        db,
        action="Tool Checked Out",
        entity_type="tool_tracking_record",
        entity_id=rec.id,
        actor_user=user,
        meta={"tool_name": tool.name},
    )
    db.commit()
    return _record_to_out(rec)


@router.post("/tracking/{record_id}/return", response_model=ToolTrackingRecordOut)
def return_tool(
    record_id: int,
    body: ToolTrackingReturnBody,
    db: Session = Depends(get_db),
    user=Depends(require_inventory_access),
):
    rec = (
        db.query(models.ToolTrackingRecord)
        .options(joinedload(models.ToolTrackingRecord.tool), joinedload(models.ToolTrackingRecord.created_by_user))
        .filter(models.ToolTrackingRecord.id == record_id)
        .first()
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Tracking record not found")
    if rec.returned_at is not None:
        raise HTTPException(status_code=400, detail="Tool already marked returned")

    returned_at = body.returned_at or datetime.utcnow()
    if returned_at < rec.checkout_at:
        raise HTTPException(status_code=400, detail="returned_at cannot be before checkout_at")

    rec.returned_at = returned_at
    db.commit()
    db.refresh(rec)
    log_activity(
        db,
        action="Tool Returned",
        entity_type="tool_tracking_record",
        entity_id=rec.id,
        actor_user=user,
        meta={"tool_name": rec.tool.name if rec.tool else None},
    )
    db.commit()
    return _record_to_out(rec)


@router.get("/{tool_id}", response_model=FactoryToolDetailResponse)
def get_tool_detail(
    tool_id: int,
    history_limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _user=Depends(require_inventory_access),
):
    row = _tool_alive(db, tool_id)
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")
    open_rec = _open_record_for_tool(db, tool_id)
    records = (
        db.query(models.ToolTrackingRecord)
        .options(joinedload(models.ToolTrackingRecord.tool), joinedload(models.ToolTrackingRecord.created_by_user))
        .filter(models.ToolTrackingRecord.tool_id == tool_id)
        .order_by(models.ToolTrackingRecord.checkout_at.desc())
        .limit(history_limit)
        .all()
    )
    return FactoryToolDetailResponse(
        tool=_tool_to_out(db, row),
        records=[_record_to_out(r) for r in records],
        current_record_id=open_rec.id if open_rec else None,
    )
