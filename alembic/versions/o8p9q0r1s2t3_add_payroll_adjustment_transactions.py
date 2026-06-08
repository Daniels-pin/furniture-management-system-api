"""Add employee_payroll_adjustments transaction table and migrate legacy data.

Revision ID: o8p9q0r1s2t3
Revises: n7o8p9q0r1s2
Create Date: 2026-06-08

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision: str = "o8p9q0r1s2t3"
down_revision: Union[str, Sequence[str], None] = "n7o8p9q0r1s2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "employee_payroll_adjustments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("period_id", sa.Integer(), nullable=False),
        sa.Column("adjustment_type", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("voided_at", sa.DateTime(), nullable=True),
        sa.Column("voided_by_id", sa.Integer(), nullable=True),
        sa.Column("void_reason", sa.String(), nullable=True),
        sa.Column("migrated_from_bonus_id", sa.Integer(), nullable=True),
        sa.Column("migrated_from_penalty_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["period_id"], ["salary_periods.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["voided_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_employee_payroll_adjustments_id", "employee_payroll_adjustments", ["id"])
    op.create_index(
        "ix_employee_payroll_adjustments_employee_id",
        "employee_payroll_adjustments",
        ["employee_id"],
    )
    op.create_index(
        "ix_employee_payroll_adjustments_period_id",
        "employee_payroll_adjustments",
        ["period_id"],
    )
    op.create_index(
        "ix_employee_payroll_adjustments_adjustment_type",
        "employee_payroll_adjustments",
        ["adjustment_type"],
    )
    op.create_index(
        "ix_employee_payroll_adjustments_created_at",
        "employee_payroll_adjustments",
        ["created_at"],
    )
    op.create_index(
        "ix_employee_payroll_adjustments_voided_at",
        "employee_payroll_adjustments",
        ["voided_at"],
    )

    conn = op.get_bind()

    # Line-item bonuses → bonus transactions
    conn.execute(
        text(
            """
            INSERT INTO employee_payroll_adjustments
                (employee_id, period_id, adjustment_type, amount, reason, notes, created_at, migrated_from_bonus_id)
            SELECT
                employee_id, period_id, 'bonus', amount, description, NULL, created_at, id
            FROM employee_bonuses
            WHERE voided_at IS NULL
            """
        )
    )

    # Line-item penalties → deduction transactions
    conn.execute(
        text(
            """
            INSERT INTO employee_payroll_adjustments
                (employee_id, period_id, adjustment_type, amount, reason, notes, created_at, migrated_from_penalty_id)
            SELECT
                employee_id, period_id, 'deduction', amount, description, NULL, created_at, id
            FROM employee_penalties
            WHERE voided_at IS NULL
            """
        )
    )

    # Aggregate adjustment_bonus on payroll rows
    conn.execute(
        text(
            """
            INSERT INTO employee_payroll_adjustments
                (employee_id, period_id, adjustment_type, amount, reason, notes, created_at)
            SELECT
                p.employee_id,
                p.period_id,
                'bonus',
                p.adjustment_bonus,
                COALESCE(NULLIF(TRIM(p.adjustment_note), ''), 'Migrated payroll adjustment (bonus)'),
                'Migrated from employee_period_payroll.adjustment_bonus',
                COALESCE(p.updated_at, NOW())
            FROM employee_period_payroll p
            WHERE p.adjustment_bonus > 0
            """
        )
    )

    # Aggregate adjustment_deduction on payroll rows
    conn.execute(
        text(
            """
            INSERT INTO employee_payroll_adjustments
                (employee_id, period_id, adjustment_type, amount, reason, notes, created_at)
            SELECT
                p.employee_id,
                p.period_id,
                'deduction',
                p.adjustment_deduction,
                COALESCE(NULLIF(TRIM(p.adjustment_note), ''), 'Migrated payroll adjustment (deduction)'),
                'Migrated from employee_period_payroll.adjustment_deduction',
                COALESCE(p.updated_at, NOW())
            FROM employee_period_payroll p
            WHERE p.adjustment_deduction > 0
            """
        )
    )

    # period_base_salary overrides → increment transactions (positive delta only)
    conn.execute(
        text(
            """
            INSERT INTO employee_payroll_adjustments
                (employee_id, period_id, adjustment_type, amount, reason, notes, created_at)
            SELECT
                p.employee_id,
                p.period_id,
                'increment',
                (p.period_base_salary - COALESCE(e.base_salary, 0)),
                COALESCE(NULLIF(TRIM(p.adjustment_note), ''), 'Migrated salary increment'),
                'Migrated from employee_period_payroll.period_base_salary',
                COALESCE(p.updated_at, NOW())
            FROM employee_period_payroll p
            JOIN employees e ON e.id = p.employee_id
            WHERE p.period_base_salary IS NOT NULL
              AND p.period_base_salary > COALESCE(e.base_salary, 0)
            """
        )
    )

    # Clear legacy aggregate fields so calculations use transactions only
    conn.execute(
        text(
            """
            UPDATE employee_period_payroll
            SET adjustment_bonus = 0,
                adjustment_deduction = 0,
                period_base_salary = NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_employee_payroll_adjustments_voided_at", table_name="employee_payroll_adjustments")
    op.drop_index("ix_employee_payroll_adjustments_created_at", table_name="employee_payroll_adjustments")
    op.drop_index("ix_employee_payroll_adjustments_adjustment_type", table_name="employee_payroll_adjustments")
    op.drop_index("ix_employee_payroll_adjustments_period_id", table_name="employee_payroll_adjustments")
    op.drop_index("ix_employee_payroll_adjustments_employee_id", table_name="employee_payroll_adjustments")
    op.drop_index("ix_employee_payroll_adjustments_id", table_name="employee_payroll_adjustments")
    op.drop_table("employee_payroll_adjustments")
