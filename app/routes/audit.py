from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.auth import require_role
from app.database import get_db
from app import models

router = APIRouter()


@router.get("/audit/logs")
def list_audit_logs(
    offset: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    lim = max(1, min(int(limit or 50), 200))
    off = max(0, int(offset or 0))
    total = db.query(func.count(models.ActionLog.id)).scalar() or 0
    q = db.query(models.ActionLog)
    rows = q.order_by(models.ActionLog.id.desc()).offset(off).limit(lim).all()
    return {
        "items": [
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
        ],
        "total": total,
    }

