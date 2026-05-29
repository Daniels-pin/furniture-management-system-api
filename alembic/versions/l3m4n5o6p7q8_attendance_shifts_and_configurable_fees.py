"""attendance shifts, configurable fees, early sign-out deductions

Revision ID: l3m4n5o6p7q8
Revises: k2l3m4n5o6p7
Create Date: 2026-05-29

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "l3m4n5o6p7q8"
down_revision: Union[str, Sequence[str], None] = "k2l3m4n5o6p7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "company_locations",
        sa.Column("shift_mode_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "company_locations",
        sa.Column("late_coming_fee_naira", sa.Numeric(14, 2), nullable=False, server_default="500"),
    )
    op.add_column(
        "company_locations",
        sa.Column("early_sign_out_fee_naira", sa.Numeric(14, 2), nullable=False, server_default="500"),
    )
    op.add_column(
        "company_locations",
        sa.Column("absence_fee_naira", sa.Numeric(14, 2), nullable=False, server_default="1000"),
    )
    op.add_column("company_locations", sa.Column("morning_shift_late_time", sa.Time(), nullable=True))
    op.add_column("company_locations", sa.Column("morning_shift_closing_time", sa.Time(), nullable=True))
    op.add_column("company_locations", sa.Column("full_day_shift_late_time", sa.Time(), nullable=True))
    op.add_column("company_locations", sa.Column("full_day_shift_closing_time", sa.Time(), nullable=True))

    op.add_column("employee_attendance_entries", sa.Column("selected_shift", sa.String(32), nullable=True))
    op.add_column("employee_attendance_entries", sa.Column("expected_late_time", sa.Time(), nullable=True))

    op.add_column(
        "employee_lateness_entries",
        sa.Column("deduction_amount_naira", sa.Numeric(14, 2), nullable=True),
    )
    op.add_column(
        "employee_absence_entries",
        sa.Column("deduction_amount_naira", sa.Numeric(14, 2), nullable=True),
    )

    op.add_column(
        "employee_period_payroll",
        sa.Column("early_sign_out_deduction_override", sa.Numeric(14, 2), nullable=True),
    )

    op.create_table(
        "employee_early_sign_out_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("period_id", sa.Integer(), nullable=False),
        sa.Column("attendance_id", sa.Integer(), nullable=True),
        sa.Column("deduction_amount_naira", sa.Numeric(14, 2), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("voided_at", sa.DateTime(), nullable=True),
        sa.Column("voided_by_id", sa.Integer(), nullable=True),
        sa.Column("void_reason", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["attendance_id"], ["employee_attendance_entries.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["period_id"], ["salary_periods.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["voided_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attendance_id", name="uq_employee_early_sign_out_attendance"),
    )
    op.create_index(
        op.f("ix_employee_early_sign_out_entries_attendance_id"),
        "employee_early_sign_out_entries",
        ["attendance_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_early_sign_out_entries_employee_id"),
        "employee_early_sign_out_entries",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_early_sign_out_entries_period_id"),
        "employee_early_sign_out_entries",
        ["period_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_early_sign_out_entries_voided_at"),
        "employee_early_sign_out_entries",
        ["voided_at"],
        unique=False,
    )

    # Backfill historical deduction amounts (legacy defaults).
    op.execute(
        "UPDATE employee_lateness_entries SET deduction_amount_naira = 500 WHERE deduction_amount_naira IS NULL"
    )
    op.execute(
        "UPDATE employee_absence_entries SET deduction_amount_naira = 1000 WHERE deduction_amount_naira IS NULL"
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_employee_early_sign_out_entries_voided_at"), table_name="employee_early_sign_out_entries")
    op.drop_index(op.f("ix_employee_early_sign_out_entries_period_id"), table_name="employee_early_sign_out_entries")
    op.drop_index(op.f("ix_employee_early_sign_out_entries_employee_id"), table_name="employee_early_sign_out_entries")
    op.drop_index(op.f("ix_employee_early_sign_out_entries_attendance_id"), table_name="employee_early_sign_out_entries")
    op.drop_table("employee_early_sign_out_entries")

    op.drop_column("employee_period_payroll", "early_sign_out_deduction_override")
    op.drop_column("employee_absence_entries", "deduction_amount_naira")
    op.drop_column("employee_lateness_entries", "deduction_amount_naira")
    op.drop_column("employee_attendance_entries", "expected_late_time")
    op.drop_column("employee_attendance_entries", "selected_shift")

    op.drop_column("company_locations", "full_day_shift_closing_time")
    op.drop_column("company_locations", "full_day_shift_late_time")
    op.drop_column("company_locations", "morning_shift_closing_time")
    op.drop_column("company_locations", "morning_shift_late_time")
    op.drop_column("company_locations", "absence_fee_naira")
    op.drop_column("company_locations", "early_sign_out_fee_naira")
    op.drop_column("company_locations", "late_coming_fee_naira")
    op.drop_column("company_locations", "shift_mode_enabled")
