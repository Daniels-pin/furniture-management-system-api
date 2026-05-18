"""add month-level payment status to salary_periods

Revision ID: e6f7a8b9c0d1
Revises: c4e5f6a7b8d9
Create Date: 2026-05-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, Sequence[str], None] = "c4e5f6a7b8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "salary_periods",
        sa.Column(
            "month_payment_status",
            sa.String(length=32),
            nullable=False,
            server_default="pending_payment",
        ),
    )
    op.add_column("salary_periods", sa.Column("month_paid_at", sa.DateTime(), nullable=True))
    op.add_column("salary_periods", sa.Column("month_paid_by_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_salary_periods_month_paid_by_id_users",
        "salary_periods",
        "users",
        ["month_paid_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_salary_periods_month_paid_by_id",
        "salary_periods",
        ["month_paid_by_id"],
        unique=False,
    )

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id FROM salary_periods ORDER BY year ASC, month ASC")
    ).fetchall()
    for (period_id,) in rows:
        emp_rows = conn.execute(
            sa.text("SELECT id FROM employees WHERE deleted_at IS NULL")
        ).fetchall()
        if not emp_rows:
            continue
        all_paid = True
        for (emp_id,) in emp_rows:
            pr = conn.execute(
                sa.text(
                    """
                    SELECT payment_status FROM employee_period_payroll
                    WHERE employee_id = :eid AND period_id = :pid
                    """
                ),
                {"eid": emp_id, "pid": period_id},
            ).fetchone()
            if pr is None or pr[0] != "paid":
                all_paid = False
                break
        if all_paid:
            conn.execute(
                sa.text(
                    """
                    UPDATE salary_periods
                    SET month_payment_status = 'paid', month_paid_at = CURRENT_TIMESTAMP
                    WHERE id = :pid
                    """
                ),
                {"pid": period_id},
            )


def downgrade() -> None:
    op.drop_index("ix_salary_periods_month_paid_by_id", table_name="salary_periods")
    op.drop_constraint("fk_salary_periods_month_paid_by_id_users", "salary_periods", type_="foreignkey")
    op.drop_column("salary_periods", "month_paid_by_id")
    op.drop_column("salary_periods", "month_paid_at")
    op.drop_column("salary_periods", "month_payment_status")
