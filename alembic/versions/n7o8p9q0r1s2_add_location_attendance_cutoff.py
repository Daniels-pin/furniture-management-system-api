"""Add per-location attendance cutoff time + cutoff run tracking.

Revision ID: n7o8p9q0r1s2
Revises: m5n6o7p8q9r0
Create Date: 2026-06-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "n7o8p9q0r1s2"
down_revision: Union[str, Sequence[str], None] = "m5n6o7p8q9r0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("company_locations", sa.Column("attendance_cutoff_time", sa.Time(), nullable=True))

    op.add_column(
        "employee_absence_entries",
        sa.Column("location_id_used", sa.Integer(), nullable=True),
    )
    op.add_column(
        "employee_absence_entries",
        sa.Column("attendance_cutoff_time_used", sa.Time(), nullable=True),
    )
    op.add_column(
        "employee_absence_entries",
        sa.Column("processed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_employee_absence_entries_location_used", "employee_absence_entries", ["location_id_used"], unique=False)
    op.create_index("ix_employee_absence_entries_processed_at", "employee_absence_entries", ["processed_at"], unique=False)
    op.create_foreign_key(
        "fk_employee_absence_entries_location_used",
        "employee_absence_entries",
        "company_locations",
        ["location_id_used"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "attendance_cutoff_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("attendance_date", sa.Date(), nullable=False),
        sa.Column("cutoff_time_used", sa.Time(), nullable=True),
        sa.Column("processed_at", sa.DateTime(), nullable=False),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["location_id"], ["company_locations.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("location_id", "attendance_date", name="uq_attendance_cutoff_runs_loc_day"),
    )
    op.create_index("ix_attendance_cutoff_runs_loc_day", "attendance_cutoff_runs", ["location_id", "attendance_date"], unique=False)
    op.create_index("ix_attendance_cutoff_runs_processed_at", "attendance_cutoff_runs", ["processed_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_attendance_cutoff_runs_processed_at", table_name="attendance_cutoff_runs")
    op.drop_index("ix_attendance_cutoff_runs_loc_day", table_name="attendance_cutoff_runs")
    op.drop_table("attendance_cutoff_runs")

    op.drop_constraint("fk_employee_absence_entries_location_used", "employee_absence_entries", type_="foreignkey")
    op.drop_index("ix_employee_absence_entries_processed_at", table_name="employee_absence_entries")
    op.drop_index("ix_employee_absence_entries_location_used", table_name="employee_absence_entries")
    op.drop_column("employee_absence_entries", "processed_at")
    op.drop_column("employee_absence_entries", "attendance_cutoff_time_used")
    op.drop_column("employee_absence_entries", "location_id_used")

    op.drop_column("company_locations", "attendance_cutoff_time")

