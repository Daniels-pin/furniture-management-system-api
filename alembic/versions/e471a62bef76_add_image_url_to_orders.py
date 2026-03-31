"""add image_url to orders

Revision ID: e471a62bef76
Revises: 0525f1d9f817
Create Date: 2026-03-31 17:53:31.910872

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e471a62bef76'
down_revision: Union[str, Sequence[str], None] = '96d226d75d11'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("image_url", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "image_url")
