"""Add line_type to document item tables.

Revision ID: 6b1f2a3c4d5e
Revises: 6382ce8e75aa
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa


revision = "6b1f2a3c4d5e"
down_revision = "6382ce8e75aa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "order_items",
        sa.Column("line_type", sa.String(), nullable=False, server_default="item"),
    )
    op.add_column(
        "quotation_items",
        sa.Column("line_type", sa.String(), nullable=False, server_default="item"),
    )
    op.add_column(
        "proforma_items",
        sa.Column("line_type", sa.String(), nullable=False, server_default="item"),
    )


def downgrade() -> None:
    op.drop_column("proforma_items", "line_type")
    op.drop_column("quotation_items", "line_type")
    op.drop_column("order_items", "line_type")

