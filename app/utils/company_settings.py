"""Load and cache singleton company settings (RC number, etc.)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app import models
from app.utils.ttl_cache import reference_cache

SINGLETON_ID = 1
_SETTINGS_CACHE_KEY = "company_settings:singleton"
_SETTINGS_CACHE_TTL = 60.0


def invalidate_company_settings_cache() -> None:
    reference_cache.invalidate(_SETTINGS_CACHE_KEY)


def get_company_settings_row(db: Session) -> models.CompanySettings:
    row = db.query(models.CompanySettings).filter(models.CompanySettings.id == SINGLETON_ID).first()
    if row is None:
        row = models.CompanySettings(id=SINGLETON_ID, rc_number=None, updated_at=datetime.utcnow())
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def get_rc_number(db: Session) -> str | None:
    def _load() -> str | None:
        row = get_company_settings_row(db)
        val = (row.rc_number or "").strip()
        return val or None

    return reference_cache.get_or_set(_SETTINGS_CACHE_KEY, _SETTINGS_CACHE_TTL, _load)
