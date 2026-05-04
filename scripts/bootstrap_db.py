"""
Bootstrap a fresh database from current SQLAlchemy models.

Why this exists:
- The Alembic "initial" revision in this repo is empty, so `alembic upgrade head`
  cannot build a schema from scratch on a brand new database.
- This script creates the *current* schema using SQLAlchemy metadata, then you
  should `alembic stamp head` to mark the DB as up-to-date.

Usage (PowerShell):
  .\\venv\\Scripts\\Activate.ps1
  python .\\scripts\\bootstrap_db.py
  alembic stamp head
"""

from __future__ import annotations

import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from app.database import engine
from app.db.base import Base  # ensures all models are imported/registered


def main() -> None:
    Base.metadata.create_all(bind=engine)
    print("Database schema created from SQLAlchemy models.")


if __name__ == "__main__":
    main()

