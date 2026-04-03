from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth.utils import verify_password, create_access_token
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app.schemas import LoginRequest
from app.config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from app.utils.activity_log import log_activity, LOGIN

router = APIRouter()

ROLE_ALIASES = {
    # Backwards compatibility: old role name -> new role name
    "manager": "factory",
}


def normalize_role(role: str | None) -> str | None:
    if role is None:
        return None
    return ROLE_ALIASES.get(role, role)


@router.post("/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == data.email).first()

    if not user or not verify_password(data.password, user.password):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    username = (user.email or "").split("@")[0] if user.email else None
    token = create_access_token(
        {
            "user_id": user.id,
            "role": normalize_role(user.role),
            "username": username,
        }
    )

    log_activity(
        db,
        action=LOGIN,
        entity_type="session",
        entity_id=user.id,
        actor_user=user,
    )
    db.commit()

    return {"access_token": token, "token_type": "bearer"}
security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    token = credentials.credentials

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")

        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")

    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(models.User).filter(models.User.id == user_id).first()

    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    return user

def require_role(allowed_roles: list):
    def role_checker(user = Depends(get_current_user)):
        effective_role = normalize_role(getattr(user, "role", None))
        effective_allowed = {normalize_role(r) for r in allowed_roles}
        if effective_role not in effective_allowed:
            raise HTTPException(status_code=403, detail="Not authorized")
        return user
    return role_checker