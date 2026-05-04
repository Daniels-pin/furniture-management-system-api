"""
Create (or update) an admin user in the configured DATABASE_URL.

Usage (PowerShell):
  $env:DATABASE_URL="postgresql+psycopg2://..."
  python .\\scripts\\create_admin_user.py
"""

from __future__ import annotations

import sys
from pathlib import Path


_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))


from app import models  # noqa: E402
from app.auth.utils import hash_password  # noqa: E402
from app.database import SessionLocal  # noqa: E402


EMAIL = "uche@nolimits.com"
PASSWORD = "123456"
ROLE = "admin"


def main() -> None:
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
            print(f"Created admin user: {EMAIL} (id={user.id})")
            return

        user.password = hash_password(PASSWORD)
        user.role = ROLE
        user.must_change_password = False
        db.commit()
        print(f"Updated admin user: {EMAIL} (id={user.id})")
    finally:
        db.close()


if __name__ == "__main__":
    main()

