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
    """Create/update one notification per recipient (no duplicate stacking).

    Dedup key: (recipient_user_id, kind, entity_type, entity_id).

    - If an existing notification matches, update it in-place, reset read_at, and bump created_at.
    - Otherwise create a new row.
    Caller controls commit boundaries.
    """
    now = datetime.utcnow()
    count = 0
    for uid in recipient_user_ids:
        if not uid:
            continue
        et = (str(entity_type).strip() if isinstance(entity_type, str) and entity_type.strip() else None)
        eid = (int(entity_id) if entity_id is not None else None)
        existing = (
            db.query(models.Notification)
            .filter(
                models.Notification.recipient_user_id == int(uid),
                models.Notification.kind == str(kind),
                models.Notification.entity_type.is_(et) if et is None else models.Notification.entity_type == et,
                models.Notification.entity_id.is_(None) if eid is None else models.Notification.entity_id == eid,
            )
            .order_by(models.Notification.id.desc())
            .first()
        )
        if existing is not None:
            existing.title = str(title)
            existing.message = (str(message).strip() if isinstance(message, str) and message.strip() else None)
            existing.created_at = now
            existing.read_at = None
            count += 1
            continue

        n = models.Notification(
            recipient_user_id=int(uid),
            kind=str(kind),
            title=str(title),
            message=(str(message).strip() if isinstance(message, str) and message.strip() else None),
            entity_type=et,
            entity_id=eid,
            created_at=now,
            read_at=None,
        )
        db.add(n)
        count += 1
    return count

