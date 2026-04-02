"""add customer birthdays and order discounts

Revision ID: d7e8f9a0b1c2
Revises: c1a2b3c4d5e6
Create Date: 2026-04-02 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, Sequence[str], None] = "c1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("birth_day", sa.Integer(), nullable=True))
    op.add_column("customers", sa.Column("birth_month", sa.Integer(), nullable=True))

    op.add_column("orders", sa.Column("discount_type", sa.String(), nullable=True))
    op.add_column("orders", sa.Column("discount_value", sa.Numeric(11, 2), nullable=True))
    op.add_column("orders", sa.Column("discount_amount", sa.Numeric(11, 2), nullable=True))
    op.add_column("orders", sa.Column("final_price", sa.Numeric(11, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "final_price")
    op.drop_column("orders", "discount_amount")
    op.drop_column("orders", "discount_value")
    op.drop_column("orders", "discount_type")
    op.drop_column("customers", "birth_month")
    op.drop_column("customers", "birth_day")

