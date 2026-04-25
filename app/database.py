import os
from sqlalchemy import create_engine
from app.db.base_class import Base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# Load environment variables
def _is_production_env() -> bool:
    return (os.getenv("RENDER") or "").strip().lower() in ("1", "true", "yes") or (
        (os.getenv("ENV") or "").strip().lower() == "production"
    )

load_dotenv(override=not _is_production_env())

DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set")

# Create engine
engine = create_engine(DATABASE_URL)

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
        