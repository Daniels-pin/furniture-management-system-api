"""add per-location late attendance time

Revision ID: h9i0j1k2l3m4
Revises: g8h9i0j1k2l3
Create Date: 2026-05-19

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "h9i0j1k2l3m4"
down_revision: Union[str, Sequence[str], None] = "g8h9i0j1k2l3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "company_locations",
        sa.Column("late_attendance_time", sa.Time(), nullable=False, server_default=sa.text("'08:15:00'")),
    )


def downgrade() -> None:
    op.drop_column("company_locations", "late_attendance_time")
