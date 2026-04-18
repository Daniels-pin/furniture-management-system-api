"""add is_active to salary_periods for payroll month navigation

Revision ID: d9e0f1a2b3c5
Revises: c8d9e0f1a2b4
Create Date: 2026-04-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d9e0f1a2b3c5"
down_revision: Union[str, Sequence[str], None] = "c8d9e0f1a2b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "salary_periods",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    conn = op.get_bind()
    # Single active period: latest calendar month present
    conn.execute(
        sa.text(
            """
            UPDATE salary_periods
            SET is_active = true
            WHERE id = (
                SELECT id FROM salary_periods
                ORDER BY year DESC, month DESC
                LIMIT 1
            )
            """
        )
    )


def downgrade() -> None:
    op.drop_column("salary_periods", "is_active")
