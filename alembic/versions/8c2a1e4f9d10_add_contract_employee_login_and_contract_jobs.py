"""add contract employee login and contract jobs

Revision ID: 8c2a1e4f9d10
Revises: 611d25689961
Create Date: 2026-04-24

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "8c2a1e4f9d10"
down_revision: Union[str, Sequence[str], None] = "611d25689961"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("contract_employees", sa.Column("bank_name", sa.String(), nullable=True))
    op.add_column("contract_employees", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_index("ix_contract_employees_user_id", "contract_employees", ["user_id"], unique=True)
    op.create_foreign_key(
        "fk_contract_employees_user_id_users",
        "contract_employees",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "contract_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("contract_employee_id", sa.Integer(), sa.ForeignKey("contract_employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_role", sa.String(), nullable=True),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("price_offer", sa.Numeric(14, 2), nullable=True),
        sa.Column("final_price", sa.Numeric(14, 2), nullable=True),
        sa.Column("price_accepted_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("cancelled_note", sa.String(length=4000), nullable=True),
    )
    op.create_index("ix_contract_jobs_id", "contract_jobs", ["id"])
    op.create_index("ix_contract_jobs_contract_employee_id", "contract_jobs", ["contract_employee_id"])
    op.create_index("ix_contract_jobs_created_at", "contract_jobs", ["created_at"])
    op.create_index("ix_contract_jobs_price_accepted_at", "contract_jobs", ["price_accepted_at"])
    op.create_index("ix_contract_jobs_started_at", "contract_jobs", ["started_at"])
    op.create_index("ix_contract_jobs_completed_at", "contract_jobs", ["completed_at"])
    op.create_index("ix_contract_jobs_cancelled_at", "contract_jobs", ["cancelled_at"])
    op.create_index("ix_contract_jobs_created_by_id", "contract_jobs", ["created_by_id"])
    op.create_index("ix_contract_jobs_cancelled_by_id", "contract_jobs", ["cancelled_by_id"])

    op.add_column("employee_transactions", sa.Column("contract_job_id", sa.Integer(), nullable=True))
    op.create_index("ix_employee_transactions_contract_job_id", "employee_transactions", ["contract_job_id"])
    op.create_foreign_key(
        "fk_employee_transactions_contract_job_id_contract_jobs",
        "employee_transactions",
        "contract_jobs",
        ["contract_job_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_employee_transactions_contract_job_id_contract_jobs", "employee_transactions", type_="foreignkey")
    op.drop_index("ix_employee_transactions_contract_job_id", table_name="employee_transactions")
    op.drop_column("employee_transactions", "contract_job_id")

    op.drop_index("ix_contract_jobs_cancelled_by_id", table_name="contract_jobs")
    op.drop_index("ix_contract_jobs_created_by_id", table_name="contract_jobs")
    op.drop_index("ix_contract_jobs_cancelled_at", table_name="contract_jobs")
    op.drop_index("ix_contract_jobs_completed_at", table_name="contract_jobs")
    op.drop_index("ix_contract_jobs_started_at", table_name="contract_jobs")
    op.drop_index("ix_contract_jobs_price_accepted_at", table_name="contract_jobs")
    op.drop_index("ix_contract_jobs_created_at", table_name="contract_jobs")
    op.drop_index("ix_contract_jobs_contract_employee_id", table_name="contract_jobs")
    op.drop_index("ix_contract_jobs_id", table_name="contract_jobs")
    op.drop_table("contract_jobs")

    op.drop_constraint("fk_contract_employees_user_id_users", "contract_employees", type_="foreignkey")
    op.drop_index("ix_contract_employees_user_id", table_name="contract_employees")
    op.drop_column("contract_employees", "user_id")
    op.drop_column("contract_employees", "bank_name")

