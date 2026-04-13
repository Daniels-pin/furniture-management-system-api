"""merge heads

Revision ID: a9d688baa04a
Revises: 6b1f2a3c4d5e, f1a2b3c4d5e6
Create Date: 2026-04-13 07:13:34.973918

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a9d688baa04a'
down_revision: Union[str, Sequence[str], None] = ('6b1f2a3c4d5e', 'f1a2b3c4d5e6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
