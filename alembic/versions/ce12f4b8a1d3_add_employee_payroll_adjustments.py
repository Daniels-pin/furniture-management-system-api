"""add employee payroll adjustments

Revision ID: ce12f4b8a1d3
Revises: a90f2225e77d
Create Date: 2026-04-27

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "ce12f4b8a1d3"
down_revision: Union[str, Sequence[str], None] = "a90f2225e77d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Postgres-safe: allow running even if columns were added manually.
    op.execute("ALTER TABLE employee_period_payroll ADD COLUMN IF NOT EXISTS period_base_salary NUMERIC(14,2)")
    op.execute("ALTER TABLE employee_period_payroll ADD COLUMN IF NOT EXISTS adjustment_bonus NUMERIC(14,2) NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE employee_period_payroll ADD COLUMN IF NOT EXISTS adjustment_deduction NUMERIC(14,2) NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE employee_period_payroll ADD COLUMN IF NOT EXISTS adjustment_late_penalty NUMERIC(14,2) NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE employee_period_payroll ADD COLUMN IF NOT EXISTS adjustment_note TEXT")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE employee_period_payroll DROP COLUMN IF EXISTS adjustment_note")
    op.execute("ALTER TABLE employee_period_payroll DROP COLUMN IF EXISTS adjustment_late_penalty")
    op.execute("ALTER TABLE employee_period_payroll DROP COLUMN IF EXISTS adjustment_deduction")
    op.execute("ALTER TABLE employee_period_payroll DROP COLUMN IF EXISTS adjustment_bonus")
    op.execute("ALTER TABLE employee_period_payroll DROP COLUMN IF EXISTS period_base_salary")

