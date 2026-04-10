"""merge heads

Revision ID: 6382ce8e75aa
Revises: e5f6a7b8c9d0, f3a9c2d1e7b4
Create Date: 2026-04-10 08:44:03.817890

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6382ce8e75aa'
down_revision: Union[str, Sequence[str], None] = ('e5f6a7b8c9d0', 'f3a9c2d1e7b4')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
