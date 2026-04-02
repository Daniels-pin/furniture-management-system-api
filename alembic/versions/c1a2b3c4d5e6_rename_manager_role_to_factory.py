"""rename manager role to factory

Revision ID: c1a2b3c4d5e6
Revises: b8f2a1c3d4e5
Create Date: 2026-04-02 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op


revision: str = "c1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "b8f2a1c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Data migration: rename role value in existing rows
    op.execute("UPDATE users SET role = 'factory' WHERE role = 'manager'")


def downgrade() -> None:
    op.execute("UPDATE users SET role = 'manager' WHERE role = 'factory'")

