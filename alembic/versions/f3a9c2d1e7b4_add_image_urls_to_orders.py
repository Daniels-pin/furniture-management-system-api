"""add image_urls to orders

Revision ID: f3a9c2d1e7b4
Revises: e471a62bef76
Create Date: 2026-04-10

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f3a9c2d1e7b4"
down_revision: Union[str, Sequence[str], None] = "e471a62bef76"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("image_urls", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "image_urls")

