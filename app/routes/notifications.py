from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import get_current_user, require_role
from app.database import get_db
from app.schemas import NotificationsPage, NotificationOut

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("/me", response_model=NotificationsPage)
def list_my_notifications(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    unread_only: bool = Query(False),
    after_id: Optional[int] = Query(None, gt=0),
    limit: int = Query(30, ge=1, le=200),
):
    q = db.query(models.Notification).filter(models.Notification.recipient_user_id == current_user.id)
    if unread_only:
        q = q.filter(models.Notification.read_at.is_(None))
    if after_id:
        q = q.filter(models.Notification.id > int(after_id))
    rows = q.order_by(models.Notification.id.desc()).limit(int(limit)).all()
    unread_count = (
        db.query(models.Notification)
        .filter(models.Notification.recipient_user_id == current_user.id, models.Notification.read_at.is_(None))
        .count()
    )
    return NotificationsPage(items=[NotificationOut.model_validate(r) for r in rows], unread_count=int(unread_count))


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    n = (
        db.query(models.Notification)
        .filter(models.Notification.id == int(notification_id), models.Notification.recipient_user_id == current_user.id)
        .first()
    )
    if n is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if n.read_at is None:
        n.read_at = datetime.utcnow()
        db.commit()
        db.refresh(n)
    return NotificationOut.model_validate(n)


@router.post("/mark-all-read")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    now = datetime.utcnow()
    updated = (
        db.query(models.Notification)
        .filter(models.Notification.recipient_user_id == current_user.id, models.Notification.read_at.is_(None))
        .update({"read_at": now})
    )
    db.commit()
    return {"updated": int(updated or 0)}


@router.post("/job-assigned/mark-read")
def mark_job_assigned_read(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Mark all unread job assignment notifications as read for the current user."""
    now = datetime.utcnow()
    updated = (
        db.query(models.Notification)
        .filter(
            models.Notification.recipient_user_id == current_user.id,
            models.Notification.kind == "job_assigned",
            models.Notification.read_at.is_(None),
        )
        .update({"read_at": now})
    )
    db.commit()
    return {"updated": int(updated or 0)}


# Admin helper (optional): send a system notification to a specific user id.
@router.post("/admin/send")
def admin_send_notification(
    payload: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    user_id = int((payload or {}).get("user_id") or 0)
    title = str((payload or {}).get("title") or "").strip()
    message = (payload or {}).get("message")
    if user_id <= 0 or not title:
        raise HTTPException(status_code=400, detail="user_id and title are required")
    u = db.query(models.User).filter(models.User.id == user_id).first()
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")
    n = models.Notification(
        recipient_user_id=user_id,
        kind="system",
        title=title,
        message=(str(message).strip() if isinstance(message, str) and message.strip() else None),
        entity_type=None,
        entity_id=None,
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return {"id": int(n.id)}

