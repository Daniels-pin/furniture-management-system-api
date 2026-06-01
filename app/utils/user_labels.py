"""Batch-resolve user display labels to avoid per-row User queries in list endpoints."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app import models
from app.utils.user_account import historical_attribution_label


def user_labels_by_id(db: Session, user_ids: set[int] | list[int]) -> dict[int, str | None]:
    ids = sorted({int(x) for x in user_ids if x})
    if not ids:
        return {}
    rows = db.query(models.User).filter(models.User.id.in_(ids)).all()
    return {int(u.id): historical_attribution_label(u) for u in rows}


def user_label(db: Session, user_id: int | None, cache: dict[int, str | None] | None = None) -> str | None:
    if user_id is None:
        return None
    uid = int(user_id)
    if cache is not None:
        if uid not in cache:
            cache[uid] = user_labels_by_id(db, [uid]).get(uid)
        return cache.get(uid)
    return user_labels_by_id(db, [uid]).get(uid)
