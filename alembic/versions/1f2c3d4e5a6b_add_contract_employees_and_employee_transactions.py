"""add contract employees and employee transactions

Revision ID: 1f2c3d4e5a6b
Revises: d9e0f1a2b3c5
Create Date: 2026-04-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "1f2c3d4e5a6b"
down_revision: Union[str, Sequence[str], None] = "d9e0f1a2b3c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "contract_employees",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("full_name", sa.String(), nullable=False),
        sa.Column("account_number", sa.String(), nullable=True),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("total_owed", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("total_paid", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("balance", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_contract_employees_id", "contract_employees", ["id"])

    op.create_table(
        "employee_transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=True),
        sa.Column(
            "contract_employee_id",
            sa.Integer(),
            sa.ForeignKey("contract_employees.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("period_id", sa.Integer(), sa.ForeignKey("salary_periods.id", ondelete="CASCADE"), nullable=True),
        sa.Column("txn_type", sa.String(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("receipt_url", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("processed_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("processed_by_role", sa.String(), nullable=True),
        sa.Column("running_balance", sa.Numeric(14, 2), nullable=True),
    )
    op.create_index("ix_employee_transactions_id", "employee_transactions", ["id"])
    op.create_index("ix_employee_transactions_employee_id", "employee_transactions", ["employee_id"])
    op.create_index("ix_employee_transactions_contract_employee_id", "employee_transactions", ["contract_employee_id"])
    op.create_index("ix_employee_transactions_period_id", "employee_transactions", ["period_id"])
    op.create_index("ix_employee_transactions_created_at", "employee_transactions", ["created_at"])
    op.create_index("ix_employee_transactions_paid_at", "employee_transactions", ["paid_at"])


def downgrade() -> None:
    op.drop_index("ix_employee_transactions_paid_at", table_name="employee_transactions")
    op.drop_index("ix_employee_transactions_created_at", table_name="employee_transactions")
    op.drop_index("ix_employee_transactions_period_id", table_name="employee_transactions")
    op.drop_index("ix_employee_transactions_contract_employee_id", table_name="employee_transactions")
    op.drop_index("ix_employee_transactions_employee_id", table_name="employee_transactions")
    op.drop_index("ix_employee_transactions_id", table_name="employee_transactions")
    op.drop_table("employee_transactions")

    op.drop_index("ix_contract_employees_id", table_name="contract_employees")
    op.drop_table("contract_employees")

