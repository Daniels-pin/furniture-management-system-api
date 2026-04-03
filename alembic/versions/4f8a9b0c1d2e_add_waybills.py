"""add waybills

Revision ID: 4f8a9b0c1d2e
Revises: 3e6f7a8b9c0d
Create Date: 2026-04-03

"""

from alembic import op
import sqlalchemy as sa


revision = "4f8a9b0c1d2e"
down_revision = "3e6f7a8b9c0d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "waybills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("waybill_number", sa.String(), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("delivery_status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_waybills_waybill_number", "waybills", ["waybill_number"], unique=True)
    op.create_index("ix_waybills_order_id", "waybills", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_waybills_order_id", table_name="waybills")
    op.drop_index("ix_waybills_waybill_number", table_name="waybills")
    op.drop_table("waybills")
