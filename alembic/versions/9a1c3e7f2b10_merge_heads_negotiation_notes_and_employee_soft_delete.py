"""merge heads: negotiation notes + employee soft delete

Revision ID: 9a1c3e7f2b10
Revises: 6f2d9b3c1a77, e3a1b2c4d5f6
Create Date: 2026-05-07 10:58:00.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "9a1c3e7f2b10"
down_revision: Union[str, Sequence[str], None] = ("6f2d9b3c1a77", "e3a1b2c4d5f6")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Merge migration (no-op)."""
    pass


def downgrade() -> None:
    """Downgrade merge (no-op)."""
    pass

