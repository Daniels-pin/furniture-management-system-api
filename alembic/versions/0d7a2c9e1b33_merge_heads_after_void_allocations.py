"""merge heads after void allocations

Revision ID: 0d7a2c9e1b33
Revises: 7f3c2a1d9b10, ce12f4b8a1d3
Create Date: 2026-04-28

"""

from typing import Sequence, Union

from alembic import op


revision: str = "0d7a2c9e1b33"
down_revision: Union[str, Sequence[str], None] = ("7f3c2a1d9b10", "ce12f4b8a1d3")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

