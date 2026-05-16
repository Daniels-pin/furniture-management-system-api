from __future__ import annotations

from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app import models
from app.auth.auth import normalize_role


def payment_notification_kinds_for_role(role: str | None) -> list[str]:
    r = normalize_role(role)
    if r == "admin":
        return ["payment_request_submitted"]
    if r == "finance":
        return ["payment_sent_to_finance"]
    return []


def mark_payment_notifications_viewed(
    db: Session,
    *,
    user_id: int,
    role: str | None,
    contract_employee_id: int | None = None,
    transaction_id: int | None = None,
) -> int:
    """Mark unread payment notification(s) as read for the current user.

    Does not change payment transaction status.
    """
    kinds = payment_notification_kinds_for_role(role)
    if not kinds:
        return 0

    q = db.query(models.Notification).filter(
        models.Notification.recipient_user_id == int(user_id),
        models.Notification.read_at.is_(None),
        models.Notification.kind.in_(kinds),
        models.Notification.entity_type == "employee_transaction",
    )

    if transaction_id is not None:
        q = q.filter(models.Notification.entity_id == int(transaction_id))
    elif contract_employee_id is not None:
        txn_ids = [
            int(x)
            for (x,) in db.query(models.EmployeeTransaction.id)
            .filter(
                models.EmployeeTransaction.contract_employee_id == int(contract_employee_id),
                models.EmployeeTransaction.txn_type == "payment",
            )
            .all()
            if x is not None
        ]
        if not txn_ids:
            return 0
        q = q.filter(models.Notification.entity_id.in_(txn_ids))
    else:
        return 0

    now = datetime.utcnow()
    updated = q.update({"read_at": now}, synchronize_session=False)
    return int(updated or 0)


def unread_payment_notification_txn_ids(
    db: Session,
    *,
    user_id: int,
    role: str | None,
    transaction_ids: Iterable[int],
) -> set[int]:
    kinds = payment_notification_kinds_for_role(role)
    ids = [int(x) for x in transaction_ids if x is not None]
    if not kinds or not ids:
        return set()
    rows = (
        db.query(models.Notification.entity_id)
        .filter(
            models.Notification.recipient_user_id == int(user_id),
            models.Notification.read_at.is_(None),
            models.Notification.kind.in_(kinds),
            models.Notification.entity_type == "employee_transaction",
            models.Notification.entity_id.in_(ids),
        )
        .all()
    )
    return {int(x) for (x,) in rows if x is not None}


CONTRACT_JOB_ALERT_KINDS = [
    "job_assigned",
    "price_updated",
    "price_accepted",
    "job_cancelled",
]


def mark_contract_job_notifications_viewed(
    db: Session,
    *,
    user_id: int,
    contract_employee_id: int | None = None,
    contract_job_id: int | None = None,
    kinds: list[str] | None = None,
) -> int:
    """Mark unread contract-job notifications as read for the current user.

    Does not change job records or negotiation state.
    """
    alert_kinds = kinds if kinds is not None else CONTRACT_JOB_ALERT_KINDS
    if not alert_kinds:
        return 0

    q = db.query(models.Notification).filter(
        models.Notification.recipient_user_id == int(user_id),
        models.Notification.read_at.is_(None),
        models.Notification.entity_type == "contract_job",
        models.Notification.kind.in_(alert_kinds),
    )

    if contract_job_id is not None:
        q = q.filter(models.Notification.entity_id == int(contract_job_id))
    elif contract_employee_id is not None:
        job_ids = [
            int(x)
            for (x,) in db.query(models.ContractJob.id)
            .filter(models.ContractJob.contract_employee_id == int(contract_employee_id))
            .all()
            if x is not None
        ]
        if not job_ids:
            return 0
        q = q.filter(models.Notification.entity_id.in_(job_ids))
    else:
        return 0

    now = datetime.utcnow()
    updated = q.update({"read_at": now}, synchronize_session=False)
    return int(updated or 0)


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

