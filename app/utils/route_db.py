"""Short-lived DB sessions for routes that must not hold connections during slow I/O."""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy.orm import Session

from app.database import SessionLocal


@contextmanager
def route_db_session(*, commit: bool = False) -> Session:
    db = SessionLocal()
    try:
        yield db
        if commit:
            db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
