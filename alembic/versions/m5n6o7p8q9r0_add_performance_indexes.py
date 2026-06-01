"""Add performance indexes for common filters and joins.

Revision ID: m5n6o7p8q9r0
Revises: l3m4n5o6p7q8
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op

revision: str = "m5n6o7p8q9r0"
down_revision: Union[str, Sequence[str], None] = "l3m4n5o6p7q8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_contract_jobs_contract_employee_status", "contract_jobs", ["contract_employee_id", "status"], unique=False)
    op.create_index("ix_contract_jobs_status", "contract_jobs", ["status"], unique=False)
    op.create_index("ix_employee_transactions_status", "employee_transactions", ["status"], unique=False)
    op.create_index("ix_employee_transactions_txn_type_status", "employee_transactions", ["txn_type", "status"], unique=False)
    op.create_index(
        "ix_financial_audit_logs_entity_action",
        "financial_audit_logs",
        ["entity_type", "entity_id", "action"],
        unique=False,
    )
    op.create_index(
        "ix_notifications_recipient_read",
        "notifications",
        ["recipient_user_id", "read_at"],
        unique=False,
    )
    op.create_index(
        "ix_employee_payment_allocations_job_void",
        "employee_payment_allocations",
        ["contract_job_id", "voided_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_employee_payment_allocations_job_void", table_name="employee_payment_allocations")
    op.drop_index("ix_notifications_recipient_read", table_name="notifications")
    op.drop_index("ix_financial_audit_logs_entity_action", table_name="financial_audit_logs")
    op.drop_index("ix_employee_transactions_txn_type_status", table_name="employee_transactions")
    op.drop_index("ix_employee_transactions_status", table_name="employee_transactions")
    op.drop_index("ix_contract_jobs_status", table_name="contract_jobs")
    op.drop_index("ix_contract_jobs_contract_employee_status", table_name="contract_jobs")
