"""add attendance deduction waivers

Revision ID: r2s3t4u5v6w7
Revises: q1r2s3t4u5v6
Create Date: 2026-08-31

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "r2s3t4u5v6w7"
down_revision: Union[str, Sequence[str], None] = "q1r2s3t4u5v6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "attendance_daily_waiver_batches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("attendance_date", sa.Date(), nullable=False),
        sa.Column("waive_late", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("waive_early_sign_out", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("waive_absence", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("reason_code", sa.String(length=64), nullable=False),
        sa.Column("reason_text", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_attendance_daily_waiver_batches_attendance_date", "attendance_daily_waiver_batches", ["attendance_date"])
    op.create_index("ix_attendance_daily_waiver_batches_created_at", "attendance_daily_waiver_batches", ["created_at"])
    op.create_index("ix_attendance_daily_waiver_batches_created_by_id", "attendance_daily_waiver_batches", ["created_by_id"])

    op.create_table(
        "attendance_deduction_waivers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("period_id", sa.Integer(), nullable=False),
        sa.Column("attendance_date", sa.Date(), nullable=False),
        sa.Column("deduction_type", sa.String(length=32), nullable=False),
        sa.Column("lateness_entry_id", sa.Integer(), nullable=True),
        sa.Column("early_sign_out_entry_id", sa.Integer(), nullable=True),
        sa.Column("absence_entry_id", sa.Integer(), nullable=True),
        sa.Column("original_amount_naira", sa.Numeric(14, 2), nullable=False),
        sa.Column("credited_amount_naira", sa.Numeric(14, 2), nullable=False),
        sa.Column("reason_code", sa.String(length=64), nullable=False),
        sa.Column("reason_text", sa.String(), nullable=True),
        sa.Column("waiver_kind", sa.String(length=16), nullable=False),
        sa.Column("daily_batch_id", sa.Integer(), nullable=True),
        sa.Column("financial_transaction_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("reversed_at", sa.DateTime(), nullable=True),
        sa.Column("reversed_by_id", sa.Integer(), nullable=True),
        sa.Column("reversal_reason", sa.String(), nullable=True),
        sa.Column("reversal_transaction_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["absence_entry_id"], ["employee_absence_entries.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["daily_batch_id"], ["attendance_daily_waiver_batches.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["early_sign_out_entry_id"], ["employee_early_sign_out_entries.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["financial_transaction_id"], ["employee_transactions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["lateness_entry_id"], ["employee_lateness_entries.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["period_id"], ["salary_periods.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reversal_transaction_id"], ["employee_transactions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reversed_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_attendance_deduction_waivers_attendance_date", "attendance_deduction_waivers", ["attendance_date"])
    op.create_index("ix_attendance_deduction_waivers_created_at", "attendance_deduction_waivers", ["created_at"])
    op.create_index("ix_attendance_deduction_waivers_created_by_id", "attendance_deduction_waivers", ["created_by_id"])
    op.create_index("ix_attendance_deduction_waivers_deduction_type", "attendance_deduction_waivers", ["deduction_type"])
    op.create_index("ix_attendance_deduction_waivers_employee_id", "attendance_deduction_waivers", ["employee_id"])
    op.create_index("ix_attendance_deduction_waivers_period_id", "attendance_deduction_waivers", ["period_id"])
    op.create_index("ix_attendance_deduction_waivers_reversed_at", "attendance_deduction_waivers", ["reversed_at"])
    op.create_index("ix_attendance_deduction_waivers_waiver_kind", "attendance_deduction_waivers", ["waiver_kind"])


def downgrade() -> None:
    op.drop_table("attendance_deduction_waivers")
    op.drop_table("attendance_daily_waiver_batches")
