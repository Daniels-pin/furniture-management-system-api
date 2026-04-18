"""add employee salary periods and payment tracking

Revision ID: c8d9e0f1a2b4
Revises: b7c8d9e0f1a3
Create Date: 2026-04-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c8d9e0f1a2b4"
down_revision: Union[str, Sequence[str], None] = "b7c8d9e0f1a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "salary_periods",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("year", "month", name="uq_salary_periods_year_month"),
    )
    op.create_index(op.f("ix_salary_periods_id"), "salary_periods", ["id"], unique=False)

    op.create_table(
        "employee_period_payroll",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("period_id", sa.Integer(), nullable=False),
        sa.Column("payment_status", sa.String(length=16), nullable=False, server_default="unpaid"),
        sa.Column("payment_date", sa.DateTime(), nullable=True),
        sa.Column("payment_reference", sa.String(length=500), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["period_id"], ["salary_periods.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", "period_id", name="uq_employee_period_payroll_emp_period"),
    )
    op.create_index(op.f("ix_employee_period_payroll_id"), "employee_period_payroll", ["id"], unique=False)
    op.create_index(
        op.f("ix_employee_period_payroll_employee_id"),
        "employee_period_payroll",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_period_payroll_period_id"),
        "employee_period_payroll",
        ["period_id"],
        unique=False,
    )

    op.add_column("employee_lateness_entries", sa.Column("period_id", sa.Integer(), nullable=True))
    op.add_column("employee_penalties", sa.Column("period_id", sa.Integer(), nullable=True))
    op.add_column("employee_bonuses", sa.Column("period_id", sa.Integer(), nullable=True))

    conn = op.get_bind()
    # Legacy backfill: assign all existing rows to April 2026
    conn.execute(
        sa.text(
            "INSERT INTO salary_periods (year, month, label, created_at) "
            "VALUES (2026, 4, 'April 2026', CURRENT_TIMESTAMP)"
        )
    )
    row = conn.execute(sa.text("SELECT id FROM salary_periods WHERE year = 2026 AND month = 4")).fetchone()
    if row is None:
        raise RuntimeError("salary_periods insert failed")
    pid = int(row[0])

    conn.execute(
        sa.text("UPDATE employee_lateness_entries SET period_id = :pid WHERE period_id IS NULL"),
        {"pid": pid},
    )
    conn.execute(
        sa.text("UPDATE employee_penalties SET period_id = :pid WHERE period_id IS NULL"),
        {"pid": pid},
    )
    conn.execute(
        sa.text("UPDATE employee_bonuses SET period_id = :pid WHERE period_id IS NULL"),
        {"pid": pid},
    )

    op.alter_column("employee_lateness_entries", "period_id", nullable=False)
    op.alter_column("employee_penalties", "period_id", nullable=False)
    op.alter_column("employee_bonuses", "period_id", nullable=False)

    op.create_foreign_key(
        "fk_lateness_period",
        "employee_lateness_entries",
        "salary_periods",
        ["period_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_penalties_period",
        "employee_penalties",
        "salary_periods",
        ["period_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_bonuses_period",
        "employee_bonuses",
        "salary_periods",
        ["period_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_index(
        op.f("ix_employee_lateness_entries_period_id"),
        "employee_lateness_entries",
        ["period_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_penalties_period_id"),
        "employee_penalties",
        ["period_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_bonuses_period_id"),
        "employee_bonuses",
        ["period_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_employee_bonuses_period_id"), table_name="employee_bonuses")
    op.drop_index(op.f("ix_employee_penalties_period_id"), table_name="employee_penalties")
    op.drop_index(op.f("ix_employee_lateness_entries_period_id"), table_name="employee_lateness_entries")

    op.drop_constraint("fk_bonuses_period", "employee_bonuses", type_="foreignkey")
    op.drop_constraint("fk_penalties_period", "employee_penalties", type_="foreignkey")
    op.drop_constraint("fk_lateness_period", "employee_lateness_entries", type_="foreignkey")

    op.drop_column("employee_bonuses", "period_id")
    op.drop_column("employee_penalties", "period_id")
    op.drop_column("employee_lateness_entries", "period_id")

    op.drop_index(op.f("ix_employee_period_payroll_period_id"), table_name="employee_period_payroll")
    op.drop_index(op.f("ix_employee_period_payroll_employee_id"), table_name="employee_period_payroll")
    op.drop_index(op.f("ix_employee_period_payroll_id"), table_name="employee_period_payroll")
    op.drop_table("employee_period_payroll")

    op.drop_index(op.f("ix_salary_periods_id"), table_name="salary_periods")
    op.drop_table("salary_periods")
