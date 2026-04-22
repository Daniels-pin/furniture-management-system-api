"""add void fields to payroll entries (no-delete financial records)

Revision ID: 3b8c1d2e4f5a
Revises: 2a7b9c1d3e4f
Create Date: 2026-04-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "3b8c1d2e4f5a"
down_revision: Union[str, Sequence[str], None] = "2a7b9c1d3e4f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("employee_lateness_entries", "employee_penalties", "employee_bonuses"):
        op.add_column(table, sa.Column("voided_at", sa.DateTime(), nullable=True))
        op.add_column(table, sa.Column("voided_by_id", sa.Integer(), nullable=True))
        op.add_column(table, sa.Column("void_reason", sa.String(), nullable=True))
        op.create_index(f"ix_{table}_voided_at", table, ["voided_at"])
        op.create_foreign_key(
            f"fk_{table}_voided_by_id",
            table,
            "users",
            ["voided_by_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    for table in ("employee_bonuses", "employee_penalties", "employee_lateness_entries"):
        op.drop_constraint(f"fk_{table}_voided_by_id", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_voided_at", table_name=table)
        op.drop_column(table, "void_reason")
        op.drop_column(table, "voided_by_id")
        op.drop_column(table, "voided_at")

