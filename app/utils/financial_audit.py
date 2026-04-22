"""Durable financial audit logging (never purged)."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app import models
from app.utils.activity_log import username_from_email

logger = logging.getLogger(__name__)


def log_financial_action(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: int | None,
    actor_user,
    meta: dict[str, Any] | None = None,
) -> None:
    """Append a FinancialAuditLog row. Caller must commit; failures are logged and do not raise."""
    try:
        db.add(
            models.FinancialAuditLog(
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                actor_user_id=getattr(actor_user, "id", None),
                actor_username=username_from_email(getattr(actor_user, "email", None)),
                meta=meta,
            )
        )
    except Exception:
        logger.exception("Failed to write financial audit log")

