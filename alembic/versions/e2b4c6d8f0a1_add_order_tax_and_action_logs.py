"""add order tax and action logs

Revision ID: e2b4c6d8f0a1
Revises: d7e8f9a0b1c2
Create Date: 2026-04-03 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e2b4c6d8f0a1"
down_revision: Union[str, Sequence[str], None] = "d7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("tax", sa.Numeric(11, 2), nullable=True))
    op.add_column("orders", sa.Column("updated_by", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("updated_at", sa.DateTime(), nullable=True))
    op.create_foreign_key("fk_orders_updated_by_users", "orders", "users", ["updated_by"], ["id"])

    op.create_table(
        "action_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("actor_username", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
    )
    op.create_index("ix_action_logs_id", "action_logs", ["id"])


def downgrade() -> None:
    op.drop_index("ix_action_logs_id", table_name="action_logs")
    op.drop_table("action_logs")

    op.drop_constraint("fk_orders_updated_by_users", "orders", type_="foreignkey")
    op.drop_column("orders", "updated_at")
    op.drop_column("orders", "updated_by")
    op.drop_column("orders", "tax")

