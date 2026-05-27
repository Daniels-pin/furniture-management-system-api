"""add attendance check-out and per-location sign-out time

Revision ID: j1k2l3m4n5o6
Revises: i0j1k2l3m4n5
Create Date: 2026-05-27

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "j1k2l3m4n5o6"
down_revision: Union[str, Sequence[str], None] = "i0j1k2l3m4n5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "company_locations",
        sa.Column("check_out_time", sa.Time(), nullable=False, server_default=sa.text("'17:00:00'")),
    )
    op.add_column("employee_attendance_entries", sa.Column("check_out_at", sa.DateTime(), nullable=True))
    op.add_column("employee_attendance_entries", sa.Column("check_out_latitude", sa.Float(), nullable=True))
    op.add_column("employee_attendance_entries", sa.Column("check_out_longitude", sa.Float(), nullable=True))
    op.add_column("employee_attendance_entries", sa.Column("check_out_distance_meters", sa.Float(), nullable=True))
    op.create_index(
        op.f("ix_employee_attendance_entries_check_out_at"),
        "employee_attendance_entries",
        ["check_out_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_employee_attendance_entries_check_out_at"), table_name="employee_attendance_entries")
    op.drop_column("employee_attendance_entries", "check_out_distance_meters")
    op.drop_column("employee_attendance_entries", "check_out_longitude")
    op.drop_column("employee_attendance_entries", "check_out_latitude")
    op.drop_column("employee_attendance_entries", "check_out_at")
    op.drop_column("company_locations", "check_out_time")
