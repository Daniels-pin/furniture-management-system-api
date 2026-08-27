from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.auth import require_role
from app.database import get_db
from app.schemas import CompanySettingsOut, CompanySettingsUpdate
from app.utils.company_settings import get_company_settings_row, invalidate_company_settings_cache

router = APIRouter(prefix="/company-settings", tags=["CompanySettings"])


@router.get("", response_model=CompanySettingsOut)
def get_company_settings(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    row = get_company_settings_row(db)
    rc = (row.rc_number or "").strip() or None
    return CompanySettingsOut(rc_number=rc, updated_at=row.updated_at)


@router.put("", response_model=CompanySettingsOut)
def update_company_settings(
    body: CompanySettingsUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    rc = (body.rc_number or "").strip()
    if not rc:
        raise HTTPException(status_code=422, detail="RC Number cannot be empty.")

    row = get_company_settings_row(db)
    row.rc_number = rc
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    invalidate_company_settings_cache()
    return CompanySettingsOut(rc_number=rc, updated_at=row.updated_at)
