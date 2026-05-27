"""add early check-out snapshot fields to attendance

Revision ID: k2l3m4n5o6p7
Revises: j1k2l3m4n5o6
Create Date: 2026-05-27

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "k2l3m4n5o6p7"
down_revision: Union[str, Sequence[str], None] = "j1k2l3m4n5o6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "employee_attendance_entries",
        sa.Column("is_early_check_out", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("employee_attendance_entries", sa.Column("early_check_out_minutes", sa.Integer(), nullable=True))
    op.add_column("employee_attendance_entries", sa.Column("expected_check_out_time", sa.Time(), nullable=True))
    op.create_index(
        op.f("ix_employee_attendance_entries_is_early_check_out"),
        "employee_attendance_entries",
        ["is_early_check_out"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_employee_attendance_entries_is_early_check_out"),
        table_name="employee_attendance_entries",
    )
    op.drop_column("employee_attendance_entries", "expected_check_out_time")
    op.drop_column("employee_attendance_entries", "early_check_out_minutes")
    op.drop_column("employee_attendance_entries", "is_early_check_out")
