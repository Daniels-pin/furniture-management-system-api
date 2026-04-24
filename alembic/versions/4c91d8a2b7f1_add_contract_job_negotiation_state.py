"""add contract job negotiation state

Revision ID: 4c91d8a2b7f1
Revises: 36a785dddb78
Create Date: 2026-04-24 19:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4c91d8a2b7f1"
down_revision: Union[str, Sequence[str], None] = "36a785dddb78"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("contract_jobs", sa.Column("last_offer_by_role", sa.String(), nullable=True))
    op.add_column("contract_jobs", sa.Column("offer_updated_at", sa.DateTime(), nullable=True))
    op.add_column(
        "contract_jobs",
        sa.Column("offer_version", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "contract_jobs",
        sa.Column("negotiation_occurred", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column("contract_jobs", sa.Column("admin_accepted_at", sa.DateTime(), nullable=True))
    op.add_column("contract_jobs", sa.Column("employee_accepted_at", sa.DateTime(), nullable=True))

    op.create_index(op.f("ix_contract_jobs_last_offer_by_role"), "contract_jobs", ["last_offer_by_role"], unique=False)
    op.create_index(op.f("ix_contract_jobs_offer_updated_at"), "contract_jobs", ["offer_updated_at"], unique=False)
    op.create_index(op.f("ix_contract_jobs_offer_version"), "contract_jobs", ["offer_version"], unique=False)
    op.create_index(op.f("ix_contract_jobs_negotiation_occurred"), "contract_jobs", ["negotiation_occurred"], unique=False)
    op.create_index(op.f("ix_contract_jobs_admin_accepted_at"), "contract_jobs", ["admin_accepted_at"], unique=False)
    op.create_index(op.f("ix_contract_jobs_employee_accepted_at"), "contract_jobs", ["employee_accepted_at"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_contract_jobs_employee_accepted_at"), table_name="contract_jobs")
    op.drop_index(op.f("ix_contract_jobs_admin_accepted_at"), table_name="contract_jobs")
    op.drop_index(op.f("ix_contract_jobs_negotiation_occurred"), table_name="contract_jobs")
    op.drop_index(op.f("ix_contract_jobs_offer_version"), table_name="contract_jobs")
    op.drop_index(op.f("ix_contract_jobs_offer_updated_at"), table_name="contract_jobs")
    op.drop_index(op.f("ix_contract_jobs_last_offer_by_role"), table_name="contract_jobs")

    op.drop_column("contract_jobs", "employee_accepted_at")
    op.drop_column("contract_jobs", "admin_accepted_at")
    op.drop_column("contract_jobs", "negotiation_occurred")
    op.drop_column("contract_jobs", "offer_version")
    op.drop_column("contract_jobs", "offer_updated_at")
    op.drop_column("contract_jobs", "last_offer_by_role")

