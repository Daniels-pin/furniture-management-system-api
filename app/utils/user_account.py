"""Removed user accounts: preserve FK integrity while stripping login and minimizing PII."""
from __future__ import annotations

import secrets

from fastapi import HTTPException

from app import models
from app.auth.utils import hash_password
from app.utils.activity_log import username_from_email


DEACTIVATED_LOGIN_DETAIL = "Your account has been deactivated. Please contact your administrator."
ACCOUNT_INACTIVE_DETAIL = "Account is inactive."


def removed_placeholder_email(user_id: int) -> str:
    """Stable unique placeholder email for anonymized users (invalid deliverability)."""
    return f"deleted_user_{int(user_id)}@example.invalid"


def is_removed_account(user: models.User | None) -> bool:
    if user is None:
        return False
    email = (getattr(user, "email", None) or "").strip().lower()
    return email.endswith("@example.invalid") and email.startswith("deleted_user_")


def is_active_account(user: models.User | None) -> bool:
    if user is None or is_removed_account(user):
        return False
    return bool(getattr(user, "is_active", True))


def assert_account_active(user: models.User) -> None:
    if not is_active_account(user):
        raise HTTPException(status_code=403, detail=ACCOUNT_INACTIVE_DETAIL)


def linked_user_account_active(db, user_id: int | None) -> bool | None:
    if user_id is None:
        return None
    u = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if u is None:
        return None
    return is_active_account(u)


def derive_historical_first_name(user: models.User) -> str:
    """
    Best-effort first name for historical attribution.
    Prefer the first whitespace-delimited token of `name` when it is not an email-like string.
    Otherwise derive from the email local-part (first segment before . _ -).
    """
    raw_name = (getattr(user, "name", None) or "").strip()
    if raw_name and "@" not in raw_name:
        token = raw_name.split()[0].strip()
        if token:
            return token[:120]

    raw_email = (getattr(user, "email", None) or "").strip()
    if "@" in raw_email:
        local = raw_email.split("@", 1)[0].strip()
        if local:
            for sep in (".", "_", "-"):
                if sep in local:
                    head = local.split(sep, 1)[0].strip()
                    if head:
                        return head[:120]
            return local[:120]

    return "Former"


def apply_user_account_removal(user: models.User) -> None:
    """
    Strip credentials and PII while keeping the row for foreign keys.
    `user.name` becomes first-name-only for UI attribution on historical records.
    """
    first = derive_historical_first_name(user)
    user.name = first
    user.email = removed_placeholder_email(user.id)
    user.password = hash_password(secrets.token_urlsafe(32))
    user.must_change_password = False
    user.is_active = False


def historical_attribution_label(user: models.User | None) -> str | None:
    """Label shown on orders, quotations, etc. for creator/updater attribution."""
    if user is None:
        return None
    if is_removed_account(user):
        fn = (getattr(user, "name", None) or "").strip()
        return fn or "Former"
    return username_from_email(getattr(user, "email", None))
