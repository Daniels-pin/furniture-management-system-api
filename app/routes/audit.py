from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.auth import require_role
from app.database import get_db
from app import models

router = APIRouter()


@router.get("/audit/logs")
def list_audit_logs(
    limit: int = 50,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    lim = max(1, min(int(limit or 50), 200))
    rows = (
        db.query(models.ActionLog)
        .order_by(models.ActionLog.id.desc())
        .limit(lim)
        .all()
    )
    return [
        {
            "id": r.id,
            "action": r.action,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "actor": r.actor_username,
            "created_at": r.created_at,
            "meta": r.meta,
        }
        for r in rows
    ]

