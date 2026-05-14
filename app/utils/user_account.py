"""Removed user accounts: preserve FK integrity while stripping login and minimizing PII."""
from __future__ import annotations

import secrets

from app import models
from app.auth.utils import hash_password
from app.utils.activity_log import username_from_email


def removed_placeholder_email(user_id: int) -> str:
    """Stable unique placeholder email for anonymized users (invalid deliverability)."""
    return f"deleted_user_{int(user_id)}@example.invalid"


def is_removed_account(user: models.User | None) -> bool:
    if user is None:
        return False
    email = (getattr(user, "email", None) or "").strip().lower()
    return email.endswith("@example.invalid") and email.startswith("deleted_user_")


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


def historical_attribution_label(user: models.User | None) -> str | None:
    """Label shown on orders, quotations, etc. for creator/updater attribution."""
    if user is None:
        return None
    if is_removed_account(user):
        fn = (getattr(user, "name", None) or "").strip()
        return fn or "Former"
    return username_from_email(getattr(user, "email", None))
