"""Signed tokens used only to safely exit an impersonation session (no passwords)."""
from __future__ import annotations

from datetime import datetime, timedelta

from jose import JWTError, jwt

from app.config import ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, SECRET_KEY

IMPERSONATION_RESTORE_PURPOSE = "impersonation_restore"


def create_impersonation_restore_token(*, admin_id: int, target_user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "purpose": IMPERSONATION_RESTORE_PURPOSE,
        "admin_id": admin_id,
        "target_user_id": target_user_id,
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_impersonation_restore_token(
    token: str, *, expected_admin_id: int, expected_target_user_id: int
) -> bool:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return False
    if payload.get("purpose") != IMPERSONATION_RESTORE_PURPOSE:
        return False
    if payload.get("admin_id") != expected_admin_id:
        return False
    if payload.get("target_user_id") != expected_target_user_id:
        return False
    return True
