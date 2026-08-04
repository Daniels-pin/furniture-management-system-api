from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.utils import hash_password
from app.auth.auth import has_admin_privileges, require_role, require_root_admin
from app.schemas import RootAdminUserCreate, UserCreate, UserResponse
from typing import List

from app.utils.activity_log import log_activity, USER_ACTIVATED, USER_CREATED, USER_DEACTIVATED, USER_DELETED
from app.utils.root_admin import (
    ROOT_ADMIN_ROLE,
    assert_can_create_role,
    assert_can_manage_user,
    user_visible_in_portal_list,
)
from app.utils.user_account import apply_user_account_removal, is_active_account, is_removed_account


router = APIRouter()


def _user_response(u: models.User) -> dict:
    return {
        "id": u.id,
        "username": u.email,
        "role": u.role,
        "is_active": is_active_account(u),
    }


def _parse_user_status_filter(status: str | None) -> str:
    value = (status or "active").strip().lower()
    if value not in ("active", "inactive", "all"):
        raise HTTPException(status_code=400, detail="status must be active, inactive, or all")
    return value


def _matches_user_status_filter(u: models.User, status: str) -> bool:
    active = is_active_account(u)
    if status == "active":
        return active
    if status == "inactive":
        return not active
    return True


@router.get("/users", response_model=List[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    status: str | None = Query("active", description="active | inactive | all"),
):
    status_filter = _parse_user_status_filter(status)
    users = db.query(models.User).order_by(models.User.id.desc()).all()
    return [
        _user_response(u)
        for u in users
        if not is_removed_account(u)
        and user_visible_in_portal_list(current_user, u)
        and _matches_user_status_filter(u, status_filter)
    ]


@router.post("/users", response_model=UserResponse)
def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    username = user_data.username.strip()
    role_value = user_data.role.value
    assert_can_create_role(current_user, role_value)

    existing_user = db.query(models.User).filter(models.User.email == username).first()

    if existing_user:
        raise HTTPException(status_code=400, detail="username must be unique")

    new_user = models.User(
        name=username,
        email=username,
        password=hash_password(user_data.password),
        role=role_value,
        is_active=True,
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    log_activity(
        db,
        action=USER_CREATED,
        entity_type="user",
        entity_id=new_user.id,
        actor_user=current_user,
        meta={"role": new_user.role},
    )
    db.commit()

    return _user_response(new_user)


@router.post("/users/root-admins", response_model=UserResponse)
def create_root_admin_user(
    user_data: RootAdminUserCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_root_admin),
):
    username = user_data.username.strip()
    existing_user = db.query(models.User).filter(models.User.email == username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="username must be unique")

    new_user = models.User(
        name=username,
        email=username,
        password=hash_password(user_data.password),
        role=ROOT_ADMIN_ROLE,
        is_active=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    log_activity(
        db,
        action=USER_CREATED,
        entity_type="user",
        entity_id=new_user.id,
        actor_user=current_user,
        meta={"role": ROOT_ADMIN_ROLE, "root_admin": True},
    )
    db.commit()

    return _user_response(new_user)


def _get_manageable_user(db: Session, user_id: int, current_user) -> models.User:
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if is_removed_account(user):
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == getattr(current_user, "id", None):
        raise HTTPException(status_code=400, detail="You cannot modify your own account.")
    assert_can_manage_user(current_user, user)
    return user


@router.post("/users/{user_id}/deactivate", response_model=UserResponse)
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    user = _get_manageable_user(db, user_id, current_user)
    if not is_active_account(user):
        return _user_response(user)

    user.is_active = False
    log_activity(
        db,
        action=USER_DEACTIVATED,
        entity_type="user",
        entity_id=user.id,
        actor_user=current_user,
        meta={"username": user.email, "role": user.role},
    )
    db.commit()
    db.refresh(user)
    return _user_response(user)


@router.post("/users/{user_id}/activate", response_model=UserResponse)
def activate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    user = _get_manageable_user(db, user_id, current_user)
    if is_active_account(user):
        return _user_response(user)

    user.is_active = True
    log_activity(
        db,
        action=USER_ACTIVATED,
        entity_type="user",
        entity_id=user.id,
        actor_user=current_user,
        meta={"username": user.email, "role": user.role},
    )
    db.commit()
    db.refresh(user)
    return _user_response(user)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if is_removed_account(user):
        return {"message": "User removed successfully"}
    if user.id == getattr(current_user, "id", None):
        raise HTTPException(status_code=400, detail="You cannot remove your own account.")

    assert_can_manage_user(current_user, user)

    uid = user.id
    prior_login = user.email
    prior_role = user.role
    log_activity(
        db,
        action=USER_DELETED,
        entity_type="user",
        entity_id=uid,
        actor_user=current_user,
        meta={"prior_login": prior_login, "prior_role": prior_role},
    )
    apply_user_account_removal(user)
    db.commit()
    return {"message": "User removed successfully"}
