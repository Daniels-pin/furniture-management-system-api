"""Purge old rows from action_logs only (admin activity audit trail)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import models

logger = logging.getLogger(__name__)

DEFAULT_RETENTION_DAYS = 30
DEFAULT_BATCH_SIZE = 5000


def purge_action_logs_older_than(
    db: Session,
    *,
    retention_days: int = DEFAULT_RETENTION_DAYS,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> int:
    """
    Delete ActionLog rows with created_at strictly before (UTC now - retention_days).

    Commits after each batch to limit transaction size and lock duration.
    """
    if retention_days < 1:
        raise ValueError("retention_days must be >= 1")
    if batch_size < 1:
        raise ValueError("batch_size must be >= 1")

    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    removed = 0

    while True:
        ids = (
            db.execute(
                select(models.ActionLog.id)
                .where(models.ActionLog.created_at < cutoff)
                .order_by(models.ActionLog.id)
                .limit(batch_size)
            )
            .scalars()
            .all()
        )
        if not ids:
            break
        res = db.execute(delete(models.ActionLog).where(models.ActionLog.id.in_(ids)))
        db.commit()
        chunk = res.rowcount if res.rowcount is not None else len(ids)
        removed += chunk
        logger.debug("Purged %s action_logs (batch), running total %s", chunk, removed)

    return removed
