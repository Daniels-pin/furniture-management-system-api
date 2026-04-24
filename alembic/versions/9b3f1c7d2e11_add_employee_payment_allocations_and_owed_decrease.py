"""add employee payment allocations and owed decrease support

Revision ID: 9b3f1c7d2e11
Revises: 8c2a1e4f9d10
Create Date: 2026-04-24

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "9b3f1c7d2e11"
down_revision: Union[str, Sequence[str], None] = "8c2a1e4f9d10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "employee_payment_allocations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "transaction_id",
            sa.Integer(),
            sa.ForeignKey("employee_transactions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "contract_job_id",
            sa.Integer(),
            sa.ForeignKey("contract_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("transaction_id", "contract_job_id", name="uq_employee_payment_allocations_txn_job"),
    )
    op.create_index("ix_employee_payment_allocations_id", "employee_payment_allocations", ["id"])
    op.create_index(
        "ix_employee_payment_allocations_transaction_id",
        "employee_payment_allocations",
        ["transaction_id"],
    )
    op.create_index(
        "ix_employee_payment_allocations_contract_job_id",
        "employee_payment_allocations",
        ["contract_job_id"],
    )
    op.create_index(
        "ix_employee_payment_allocations_created_at",
        "employee_payment_allocations",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_employee_payment_allocations_created_at", table_name="employee_payment_allocations")
    op.drop_index("ix_employee_payment_allocations_contract_job_id", table_name="employee_payment_allocations")
    op.drop_index("ix_employee_payment_allocations_transaction_id", table_name="employee_payment_allocations")
    op.drop_index("ix_employee_payment_allocations_id", table_name="employee_payment_allocations")
    op.drop_table("employee_payment_allocations")

