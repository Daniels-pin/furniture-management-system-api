"""add employee bank_name

Revision ID: a90f2225e77d
Revises: d05261d4a17d
Create Date: 2026-04-27 03:55:20.536080

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a90f2225e77d'
down_revision: Union[str, Sequence[str], None] = 'd05261d4a17d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Postgres-safe: allow running even if column was added manually.
    op.execute("ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_name VARCHAR(200)")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres-safe rollback
    op.execute("ALTER TABLE employees DROP COLUMN IF EXISTS bank_name")
