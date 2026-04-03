"""add order_item amount

Revision ID: 0b3f6c7d8e9f
Revises: e2b4c6d8f0a1
Create Date: 2026-04-03

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0b3f6c7d8e9f"
down_revision = "e2b4c6d8f0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("order_items", sa.Column("amount", sa.Numeric(11, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("order_items", "amount")

