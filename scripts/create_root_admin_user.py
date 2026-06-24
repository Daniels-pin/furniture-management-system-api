"""
Create (or update) a Root Admin user in the configured DATABASE_URL.

Root Admin is an internal system role — not assignable through the normal Create User UI.

Usage:
  $env:DATABASE_URL="postgresql+psycopg2://..."
  $env:ROOT_ADMIN_EMAIL="owner@example.com"
  $env:ROOT_ADMIN_PASSWORD="your-secure-password"
  python .\\scripts\\create_root_admin_user.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))


from app import models  # noqa: E402
from app.auth.utils import hash_password  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.utils.root_admin import ROOT_ADMIN_ROLE  # noqa: E402


EMAIL = os.getenv("ROOT_ADMIN_EMAIL", "root@nolimits.com").strip()
PASSWORD = os.getenv("ROOT_ADMIN_PASSWORD", "change-me-now")
ROLE = ROOT_ADMIN_ROLE


def main() -> None:
    if not EMAIL:
        raise SystemExit("ROOT_ADMIN_EMAIL is required")
    if len(PASSWORD) < 8:
        raise SystemExit("ROOT_ADMIN_PASSWORD must be at least 8 characters")

    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.email == EMAIL).first()
        if user is None:
            user = models.User(
                name=EMAIL,
                email=EMAIL,
                password=hash_password(PASSWORD),
                role=ROLE,
                must_change_password=False,
                password_changed_at=None,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Created Root Admin user: {EMAIL} (id={user.id})")
            return

        user.password = hash_password(PASSWORD)
        user.role = ROLE
        user.must_change_password = False
        db.commit()
        print(f"Updated Root Admin user: {EMAIL} (id={user.id})")
    finally:
        db.close()


if __name__ == "__main__":
    main()
