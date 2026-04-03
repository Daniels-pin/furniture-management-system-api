from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.utils import hash_password
from app.auth.auth import require_role
from app.schemas import UserRole, UserCreate, UserResponse
from typing import List

from app.utils.activity_log import log_activity, USER_CREATED, USER_DELETED


router = APIRouter()

@router.get("/users", response_model=List[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    current_user = Depends(require_role(["admin"]))
):
    users = db.query(models.User).order_by(models.User.id.desc()).all()
    return [{"id": u.id, "username": u.email, "role": u.role} for u in users]


@router.post("/users", response_model=UserResponse)
def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user = Depends(require_role(["admin"]))
):
    username = user_data.username.strip()
    # Role validation is handled by the schema enum; no additional checks here.

    # Use username as unique email identifier in DB
    existing_user = db.query(models.User).filter(models.User.email == username).first()

    if existing_user:
        raise HTTPException(status_code=400, detail="username must be unique")

    new_user = models.User(
        name=username,
        email=username,
        password=hash_password(user_data.password),
        role=user_data.role.value
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

    return {"id": new_user.id, "username": new_user.email, "role": new_user.role}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_role(["admin"]))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    uid = user.id
    log_activity(
        db,
        action=USER_DELETED,
        entity_type="user",
        entity_id=uid,
        actor_user=current_user,
    )
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}
