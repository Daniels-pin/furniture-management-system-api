"""add financial audit logs, expenses, and transaction reversals

Revision ID: 2a7b9c1d3e4f
Revises: 1f2c3d4e5a6b
Create Date: 2026-04-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "2a7b9c1d3e4f"
down_revision: Union[str, Sequence[str], None] = "1f2c3d4e5a6b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("employee_transactions", sa.Column("reversal_of_id", sa.Integer(), nullable=True))
    op.create_index("ix_employee_transactions_reversal_of_id", "employee_transactions", ["reversal_of_id"])
    op.create_foreign_key(
        "fk_employee_transactions_reversal_of_id",
        "employee_transactions",
        "employee_transactions",
        ["reversal_of_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "financial_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_username", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("meta", sa.JSON(), nullable=True),
    )
    op.create_index("ix_financial_audit_logs_id", "financial_audit_logs", ["id"])
    op.create_index("ix_financial_audit_logs_created_at", "financial_audit_logs", ["created_at"])

    op.create_table(
        "expense_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entry_date", sa.DateTime(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("entry_type", sa.String(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("receipt_url", sa.String(), nullable=True),
        sa.Column("processed_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("processed_by_role", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_expense_entries_id", "expense_entries", ["id"])
    op.create_index("ix_expense_entries_entry_date", "expense_entries", ["entry_date"])
    op.create_index("ix_expense_entries_created_at", "expense_entries", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_expense_entries_created_at", table_name="expense_entries")
    op.drop_index("ix_expense_entries_entry_date", table_name="expense_entries")
    op.drop_index("ix_expense_entries_id", table_name="expense_entries")
    op.drop_table("expense_entries")

    op.drop_index("ix_financial_audit_logs_created_at", table_name="financial_audit_logs")
    op.drop_index("ix_financial_audit_logs_id", table_name="financial_audit_logs")
    op.drop_table("financial_audit_logs")

    op.drop_constraint("fk_employee_transactions_reversal_of_id", "employee_transactions", type_="foreignkey")
    op.drop_index("ix_employee_transactions_reversal_of_id", table_name="employee_transactions")
    op.drop_column("employee_transactions", "reversal_of_id")

