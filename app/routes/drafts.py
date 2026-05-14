from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import reject_staff
from app.database import get_db

router = APIRouter()


ALLOWED_MODULES = {"quotation", "order", "proforma"}


def _validate_module(module: str) -> str:
    m = (module or "").strip().lower()
    if m not in ALLOWED_MODULES:
        raise HTTPException(status_code=422, detail="Invalid module")
    return m


@router.get("/drafts")
def list_drafts(
    db: Session = Depends(get_db),
    user=Depends(reject_staff),
):
    rows = (
        db.query(models.Draft)
        .filter(models.Draft.user_id == user.id)
        .order_by(models.Draft.updated_at.desc())
        .all()
    )
    return {
        "items": [
            {
                "module": r.module,
                "updated_at": r.updated_at,
            }
            for r in rows
        ]
    }


@router.get("/drafts/latest")
def latest_draft(
    db: Session = Depends(get_db),
    user=Depends(reject_staff),
    modules: str | None = Query(default=None, description="Comma-separated module allowlist"),
):
    allow = None
    if modules is not None:
        allow = {_validate_module(x) for x in modules.split(",") if x.strip()}
    q = db.query(models.Draft).filter(models.Draft.user_id == user.id)
    if allow:
        q = q.filter(models.Draft.module.in_(sorted(allow)))
    row = q.order_by(models.Draft.updated_at.desc()).first()
    if not row:
        return {"draft": None}
    return {"draft": {"module": row.module, "updated_at": row.updated_at}}


@router.get("/drafts/{module}")
def get_draft(
    module: str,
    db: Session = Depends(get_db),
    user=Depends(reject_staff),
):
    m = _validate_module(module)
    row = (
        db.query(models.Draft)
        .filter(models.Draft.user_id == user.id)
        .filter(models.Draft.module == m)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"module": row.module, "data": row.data, "updated_at": row.updated_at}


@router.put("/drafts/{module}")
def upsert_draft(
    module: str,
    body: dict[str, Any],
    db: Session = Depends(get_db),
    user=Depends(reject_staff),
):
    m = _validate_module(module)
    now = datetime.utcnow()
    row = (
        db.query(models.Draft)
        .filter(models.Draft.user_id == user.id)
        .filter(models.Draft.module == m)
        .first()
    )
    if row is None:
        row = models.Draft(user_id=user.id, module=m, data=body, created_at=now, updated_at=now)
        db.add(row)
    else:
        row.data = body
        row.updated_at = now
    db.commit()
    db.refresh(row)
    return {"module": row.module, "updated_at": row.updated_at}


@router.delete("/drafts/{module}")
def delete_draft(
    module: str,
    db: Session = Depends(get_db),
    user=Depends(reject_staff),
):
    m = _validate_module(module)
    row = (
        db.query(models.Draft)
        .filter(models.Draft.user_id == user.id)
        .filter(models.Draft.module == m)
        .first()
    )
    if not row:
        return {"message": "No draft to delete"}
    db.delete(row)
    db.commit()
    return {"message": "Draft deleted"}

