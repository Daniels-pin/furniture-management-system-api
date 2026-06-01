import os
from pathlib import Path

from sqlalchemy import create_engine
from app.db.base_class import Base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# Load environment variables
def _is_production_env() -> bool:
    return (os.getenv("RENDER") or "").strip().lower() in ("1", "true", "yes") or (
        (os.getenv("ENV") or "").strip().lower() == "production"
    )

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env", override=not _is_production_env())

DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Add it to the project root .env file "
        f"(expected at {_PROJECT_ROOT / '.env'}) or export it in your environment."
    )

# Sized for ~25 concurrent users on a single web worker (35–70 total users).
# pre_ping/recycle avoid stale connections on Render; keep transactions short to avoid pool exhaustion.
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=280,
    pool_size=8,
    max_overflow=12,
    pool_timeout=20,
)

# Session
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base


# Dependency
from sqlalchemy.orm import Session

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
