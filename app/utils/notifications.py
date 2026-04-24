from __future__ import annotations

from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app import models


def create_notifications(
    db: Session,
    *,
    recipient_user_ids: Iterable[int],
    kind: str,
    title: str,
    message: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
) -> int:
    """Create one notification per recipient. Caller controls commit boundaries."""
    now = datetime.utcnow()
    count = 0
    for uid in recipient_user_ids:
        if not uid:
            continue
        n = models.Notification(
            recipient_user_id=int(uid),
            kind=str(kind),
            title=str(title),
            message=(str(message).strip() if isinstance(message, str) and message.strip() else None),
            entity_type=(str(entity_type).strip() if isinstance(entity_type, str) and entity_type.strip() else None),
            entity_id=(int(entity_id) if entity_id is not None else None),
            created_at=now,
            read_at=None,
        )
        db.add(n)
        count += 1
    return count

