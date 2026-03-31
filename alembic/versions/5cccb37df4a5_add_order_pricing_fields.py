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
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
