"""add order pricing fields

Revision ID: 5cccb37df4a5
Revises: e471a62bef76
Create Date: 2026-03-31 18:21:35.942189

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5cccb37df4a5'
down_revision: Union[str, Sequence[str], None] = 'e471a62bef76'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("total_price", sa.Numeric(11, 2), nullable=True))
    op.add_column("orders", sa.Column("amount_paid", sa.Numeric(11, 2), nullable=True))
    op.add_column("orders", sa.Column("balance", sa.Numeric(11, 2), nullable=True))
    op.add_column(
        "orders",
        sa.Column("payment_status", sa.String(), nullable=False, server_default="unpaid"),
    )


def downgrade() -> None:
    op.drop_column("orders", "payment_status")
    op.drop_column("orders", "balance")
    op.drop_column("orders", "amount_paid")
    op.drop_column("orders", "total_price")