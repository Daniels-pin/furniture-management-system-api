"""add contract job negotiation notes

Revision ID: 6f2d9b3c1a77
Revises: 4c91d8a2b7f1
Create Date: 2026-05-07 10:55:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "6f2d9b3c1a77"
down_revision: Union[str, Sequence[str], None] = "4c91d8a2b7f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "contract_job_negotiation_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("contract_job_id", sa.Integer(), sa.ForeignKey("contract_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=64), server_default="offer_update", nullable=False),
        sa.Column("offer_price", sa.Numeric(14, 2), nullable=False),
        sa.Column("note", sa.String(length=2000), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_role", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index(op.f("ix_contract_job_negotiation_events_contract_job_id"), "contract_job_negotiation_events", ["contract_job_id"], unique=False)
    op.create_index(op.f("ix_contract_job_negotiation_events_kind"), "contract_job_negotiation_events", ["kind"], unique=False)
    op.create_index(op.f("ix_contract_job_negotiation_events_actor_user_id"), "contract_job_negotiation_events", ["actor_user_id"], unique=False)
    op.create_index(op.f("ix_contract_job_negotiation_events_actor_role"), "contract_job_negotiation_events", ["actor_role"], unique=False)
    op.create_index(op.f("ix_contract_job_negotiation_events_created_at"), "contract_job_negotiation_events", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_contract_job_negotiation_events_created_at"), table_name="contract_job_negotiation_events")
    op.drop_index(op.f("ix_contract_job_negotiation_events_actor_role"), table_name="contract_job_negotiation_events")
    op.drop_index(op.f("ix_contract_job_negotiation_events_actor_user_id"), table_name="contract_job_negotiation_events")
    op.drop_index(op.f("ix_contract_job_negotiation_events_kind"), table_name="contract_job_negotiation_events")
    op.drop_index(op.f("ix_contract_job_negotiation_events_contract_job_id"), table_name="contract_job_negotiation_events")
    op.drop_table("contract_job_negotiation_events")

