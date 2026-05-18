"""add work_location_assigned_at to employees

Revision ID: g8h9i0j1k2l3
Revises: f7a8b9c0d1e2
Create Date: 2026-05-18

"""

from typing import Sequence, Union

from alembic import op


revision: str = "g8h9i0j1k2l3"
down_revision: Union[str, Sequence[str], None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_location_assigned_at TIMESTAMP")
    op.execute(
        """
        UPDATE employees
        SET work_location_assigned_at = COALESCE(created_at, NOW())
        WHERE work_location_id IS NOT NULL
          AND work_location_assigned_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE employees DROP COLUMN IF EXISTS work_location_assigned_at")
