"""add monthly employee attendance

Revision ID: f2c3d4e5f6a8
Revises: 9a1c3e7f2b10
Create Date: 2026-05-07

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f2c3d4e5f6a8"
down_revision: Union[str, Sequence[str], None] = "9a1c3e7f2b10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "employee_attendance_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("period_id", sa.Integer(), nullable=False),
        sa.Column("attendance_date", sa.Date(), nullable=False),
        sa.Column("check_in_at", sa.DateTime(), nullable=False),
        sa.Column("is_late", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("late_minutes", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["period_id"], ["salary_periods.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", "attendance_date", name="uq_employee_attendance_emp_date"),
    )
    op.create_index(op.f("ix_employee_attendance_entries_id"), "employee_attendance_entries", ["id"], unique=False)
    op.create_index(
        op.f("ix_employee_attendance_entries_employee_id"),
        "employee_attendance_entries",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_attendance_entries_period_id"),
        "employee_attendance_entries",
        ["period_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_attendance_entries_attendance_date"),
        "employee_attendance_entries",
        ["attendance_date"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_attendance_entries_check_in_at"),
        "employee_attendance_entries",
        ["check_in_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_attendance_entries_is_late"),
        "employee_attendance_entries",
        ["is_late"],
        unique=False,
    )

    op.add_column("employee_lateness_entries", sa.Column("attendance_id", sa.Integer(), nullable=True))
    op.create_index(
        op.f("ix_employee_lateness_entries_attendance_id"),
        "employee_lateness_entries",
        ["attendance_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_employee_lateness_entries_attendance",
        "employee_lateness_entries",
        "employee_attendance_entries",
        ["attendance_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Unique: allows multiple NULLs (Postgres behavior) and prevents duplicates when set.
    op.create_unique_constraint(
        "uq_employee_lateness_entries_attendance_id",
        "employee_lateness_entries",
        ["attendance_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_employee_lateness_entries_attendance_id", "employee_lateness_entries", type_="unique")
    op.drop_constraint("fk_employee_lateness_entries_attendance", "employee_lateness_entries", type_="foreignkey")
    op.drop_index(op.f("ix_employee_lateness_entries_attendance_id"), table_name="employee_lateness_entries")
    op.drop_column("employee_lateness_entries", "attendance_id")

    op.drop_index(op.f("ix_employee_attendance_entries_is_late"), table_name="employee_attendance_entries")
    op.drop_index(op.f("ix_employee_attendance_entries_check_in_at"), table_name="employee_attendance_entries")
    op.drop_index(op.f("ix_employee_attendance_entries_attendance_date"), table_name="employee_attendance_entries")
    op.drop_index(op.f("ix_employee_attendance_entries_period_id"), table_name="employee_attendance_entries")
    op.drop_index(op.f("ix_employee_attendance_entries_employee_id"), table_name="employee_attendance_entries")
    op.drop_index(op.f("ix_employee_attendance_entries_id"), table_name="employee_attendance_entries")
    op.drop_table("employee_attendance_entries")

