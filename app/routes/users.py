from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.utils import hash_password
from app.auth.auth import require_role
from app.schemas import UserRole, UserCreate, UserResponse
from typing import List



router = APIRouter()

@router.get("/users", response_model=List[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    current_user = Depends(require_role(["admin"]))
):
    return db.query(models.User).order_by(models.User.id.desc()).all()


@router.post("/users", response_model=UserResponse)
def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user = Depends(require_role(["admin"]))
):
    existing_user = db.query(models.User).filter(
        models.User.email == user_data.email
    ).first()

    if existing_user:
        raise HTTPException(status_code=400, detail="Email already exists")

    new_user = models.User(
        name=user_data.name,
        email=user_data.email,
        password=hash_password(user_data.password),
        role=user_data.role.value
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_role(["admin"]))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}
