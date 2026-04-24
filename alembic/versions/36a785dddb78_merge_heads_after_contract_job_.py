"""merge heads after contract job description

Revision ID: 36a785dddb78
Revises: c42f7a1d2c3e, d2c6a1f4d0a1
Create Date: 2026-04-24 18:54:52.141292

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '36a785dddb78'
down_revision: Union[str, Sequence[str], None] = ('c42f7a1d2c3e', 'd2c6a1f4d0a1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
