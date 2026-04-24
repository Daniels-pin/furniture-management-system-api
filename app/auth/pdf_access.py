"""Allow document GET endpoints to accept either a normal user JWT or a pdf_render token."""
from __future__ import annotations

from types import SimpleNamespace

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import normalize_role
from app.config import ALGORITHM, SECRET_KEY
from app.database import get_db
from app.utils.pdf_token import PDF_PURPOSE, verify_pdf_render_token

bearer_optional = HTTPBearer(auto_error=False)


def _pdf_actor():
    """Synthetic user so existing handlers treat PDF export like showroom (full customer data)."""
    return SimpleNamespace(id=0, role="showroom", email="pdf-render@local", name="PDF Render")


def _user_from_login_token(token: str, db: Session) -> models.User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token") from None
    if payload.get("purpose") == PDF_PURPOSE:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload.get("user_id")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def _require_bearer(credentials: HTTPAuthorizationCredentials | None) -> str:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return credentials.credentials


def require_invoice_reader(
    invoice_id: int,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_optional),
    db: Session = Depends(get_db),
):
    tok = _require_bearer(credentials)
    if verify_pdf_render_token(tok, "invoice", invoice_id):
        return _pdf_actor()
    user = _user_from_login_token(tok, db)
    if normalize_role(user.role) not in {"admin", "showroom", "finance"}:
        raise HTTPException(status_code=403, detail="Not authorized")
    return user


def require_quotation_reader(
    quotation_id: int,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_optional),
    db: Session = Depends(get_db),
):
    tok = _require_bearer(credentials)
    if verify_pdf_render_token(tok, "quotation", quotation_id):
        return _pdf_actor()
    user = _user_from_login_token(tok, db)
    if normalize_role(user.role) not in {"admin", "showroom", "finance"}:
        raise HTTPException(status_code=403, detail="Not authorized")
    return user


def require_proforma_reader(
    proforma_id: int,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_optional),
    db: Session = Depends(get_db),
):
    tok = _require_bearer(credentials)
    if verify_pdf_render_token(tok, "proforma", proforma_id):
        return _pdf_actor()
    user = _user_from_login_token(tok, db)
    if normalize_role(user.role) not in {"admin", "showroom", "finance"}:
        raise HTTPException(status_code=403, detail="Not authorized")
    return user


def require_waybill_reader(
    waybill_id: int,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_optional),
    db: Session = Depends(get_db),
):
    tok = _require_bearer(credentials)
    if verify_pdf_render_token(tok, "waybill", waybill_id):
        return _pdf_actor()
    user = _user_from_login_token(tok, db)
    if normalize_role(user.role) not in {"admin", "showroom", "finance"}:
        raise HTTPException(status_code=403, detail="Not authorized")
    return user


def require_order_reader(
    order_id: int,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_optional),
    db: Session = Depends(get_db),
):
    tok = _require_bearer(credentials)
    if verify_pdf_render_token(tok, "order", order_id):
        return _pdf_actor()
    user = _user_from_login_token(tok, db)
    if normalize_role(user.role) not in {"admin", "showroom", "factory", "finance"}:
        raise HTTPException(status_code=403, detail="Not authorized")
    return user
