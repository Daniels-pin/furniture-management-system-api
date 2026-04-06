from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import normalize_role, require_role
from app.auth.impersonation_tokens import create_impersonation_restore_token, verify_impersonation_restore_token
from app.auth.utils import create_access_token
from app.config import ALGORITHM, SECRET_KEY
from app.database import get_db
from app.utils.activity_log import (
    IMPERSONATION_STARTED,
    IMPERSONATION_STOPPED,
    log_activity,
    username_from_email,
)

router = APIRouter(prefix="/admin", tags=["Admin"])
_security = HTTPBearer()


def _subject_label(user: models.User) -> str:
    name = (getattr(user, "name", None) or "").strip()
    if name:
        return name
    email = (getattr(user, "email", None) or "").strip()
    if email and "@" in email:
        return email.split("@", 1)[0].strip() or email
    if email:
        return email
    return f"User #{user.id}"


@router.post("/impersonate/{user_id}")
def impersonate_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_role(["admin"])),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot impersonate yourself")

    target = db.query(models.User).filter(models.User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    username = username_from_email(target.email)
    token = create_access_token(
        {
            "user_id": target.id,
            "role": normalize_role(target.role),
            "username": username,
            "impersonated_by": admin.id,
            "is_impersonation": True,
            "impersonation_subject": _subject_label(target),
        }
    )
    restore_token = create_impersonation_restore_token(admin_id=admin.id, target_user_id=target.id)

    log_activity(
        db,
        action=IMPERSONATION_STARTED,
        entity_type="impersonation",
        entity_id=target.id,
        actor_user=admin,
        meta={
            "target_user_id": target.id,
            "admin_id": admin.id,
            "target_role": normalize_role(target.role),
        },
    )
    db.commit()

    return {
        "access_token": token,
        "token_type": "bearer",
        "restore_token": restore_token,
    }


class StopImpersonationBody(BaseModel):
    restore_token: str = Field(..., min_length=10)


@router.post("/stop-impersonation")
def stop_impersonation(
    body: StopImpersonationBody,
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials = Depends(_security),
):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    if not payload.get("is_impersonation"):
        raise HTTPException(status_code=400, detail="Not an impersonation session")

    admin_id = payload.get("impersonated_by")
    target_user_id = payload.get("user_id")
    if admin_id is None or target_user_id is None:
        raise HTTPException(status_code=401, detail="Invalid impersonation token")

    if not verify_impersonation_restore_token(
        body.restore_token,
        expected_admin_id=int(admin_id),
        expected_target_user_id=int(target_user_id),
    ):
        raise HTTPException(status_code=403, detail="Invalid or expired restore token")

    admin = db.query(models.User).filter(models.User.id == int(admin_id)).first()
    if admin is None or normalize_role(admin.role) != "admin":
        raise HTTPException(status_code=403, detail="Original admin account is not valid")

    username = username_from_email(admin.email)
    new_token = create_access_token(
        {
            "user_id": admin.id,
            "role": normalize_role(admin.role),
            "username": username,
        }
    )

    log_activity(
        db,
        action=IMPERSONATION_STOPPED,
        entity_type="impersonation",
        entity_id=int(target_user_id),
        actor_user=admin,
        meta={
            "target_user_id": int(target_user_id),
            "admin_id": admin.id,
        },
    )
    db.commit()

    return {"access_token": new_token, "token_type": "bearer"}
