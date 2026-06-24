"""Root Admin: internal system role for software owner / maintenance accounts."""
from __future__ import annotations

from fastapi import HTTPException

ROOT_ADMIN_ROLE = "root_admin"
ADMIN_ROLES = frozenset({"admin", ROOT_ADMIN_ROLE})


def is_root_admin_role(role: str | None) -> bool:
    return role == ROOT_ADMIN_ROLE


def is_root_admin_user(user) -> bool:
    return is_root_admin_role(getattr(user, "role", None))


def has_admin_privileges(user) -> bool:
    """True when the user has standard Admin capabilities (admin or root_admin)."""
    return getattr(user, "role", None) in ADMIN_ROLES


def user_visible_in_portal_list(viewer, target_user) -> bool:
    """Root Admin accounts are hidden from regular Admin user listings."""
    if is_root_admin_role(getattr(target_user, "role", None)):
        return is_root_admin_user(viewer)
    return True


def assert_can_manage_user(actor, target) -> None:
    """Only Root Admin may manage another Root Admin account."""
    if not is_root_admin_role(getattr(target, "role", None)):
        return
    if not is_root_admin_user(actor):
        raise HTTPException(
            status_code=403,
            detail="Only a Root Admin may manage this account.",
        )


def assert_can_create_role(actor, role: str) -> None:
    """Root Admin role cannot be created via normal user flows."""
    if role == ROOT_ADMIN_ROLE and not is_root_admin_user(actor):
        raise HTTPException(status_code=403, detail="Root Admin accounts cannot be created through this interface.")


def system_linked_employee_ids(db) -> set[int]:
    """Employee records linked to Root Admin portal accounts (defensive exclusion)."""
    from app import models

    rows = (
        db.query(models.Employee.id)
        .join(models.User, models.Employee.user_id == models.User.id)
        .filter(models.User.role == ROOT_ADMIN_ROLE)
        .all()
    )
    return {int(eid) for (eid,) in rows if eid is not None}


def exclude_system_employee_ids(db, emp_ids: list[int]) -> list[int]:
    exclude = system_linked_employee_ids(db)
    if not exclude:
        return emp_ids
    return [eid for eid in emp_ids if int(eid) not in exclude]


def admin_user_ids_for_notifications(db) -> list[int]:
    """Portal user IDs that should receive admin-targeted notifications."""
    from app import models

    return [
        int(uid)
        for (uid,) in db.query(models.User.id).filter(models.User.role.in_(tuple(ADMIN_ROLES))).all()
        if uid is not None
    ]
