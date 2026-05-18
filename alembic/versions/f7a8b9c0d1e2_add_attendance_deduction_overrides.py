"""add attendance deduction overrides to employee_period_payroll

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-05-18

"""

from typing import Sequence, Union

from alembic import op


revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, Sequence[str], None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE employee_period_payroll "
        "ADD COLUMN IF NOT EXISTS lateness_deduction_override NUMERIC(14,2)"
    )
    op.execute(
        "ALTER TABLE employee_period_payroll "
        "ADD COLUMN IF NOT EXISTS absence_deduction_override NUMERIC(14,2)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE employee_period_payroll DROP COLUMN IF EXISTS absence_deduction_override")
    op.execute("ALTER TABLE employee_period_payroll DROP COLUMN IF EXISTS lateness_deduction_override")
