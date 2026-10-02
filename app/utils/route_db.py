"""Short-lived DB sessions for routes that must not hold connections during slow I/O."""
from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace

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


def actor_snapshot(user) -> SimpleNamespace:
    """Copy identity fields so callers can close the request session before slow work."""
    return SimpleNamespace(
        id=getattr(user, "id", None),
        role=getattr(user, "role", None),
        email=getattr(user, "email", None),
        name=getattr(user, "name", None),
    )


def release_request_db(db: Session) -> None:
    """Return the request's pooled connection before long-running work such as PDF rendering."""
    db.close()
