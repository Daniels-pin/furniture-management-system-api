"""Short-lived JWTs so headless Chromium can load authenticated PDF export URLs."""
from __future__ import annotations

from datetime import datetime, timedelta

from jose import JWTError, jwt

from app.config import ALGORITHM, SECRET_KEY

PDF_PURPOSE = "pdf_render"
DEFAULT_PDF_TOKEN_TTL_SEC = 300


def create_pdf_render_token(doc: str, doc_id: int, ttl_sec: int = DEFAULT_PDF_TOKEN_TTL_SEC) -> str:
    expire = datetime.utcnow() + timedelta(seconds=max(30, ttl_sec))
    payload = {"purpose": PDF_PURPOSE, "doc": doc, "doc_id": doc_id, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_pdf_render_token(token: str, doc: str, doc_id: int) -> bool:
    try:
        p = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return False
    raw_id = p.get("doc_id")
    try:
        id_ok = int(raw_id) == int(doc_id)
    except (TypeError, ValueError):
        id_ok = False
    return p.get("purpose") == PDF_PURPOSE and p.get("doc") == doc and id_ok
