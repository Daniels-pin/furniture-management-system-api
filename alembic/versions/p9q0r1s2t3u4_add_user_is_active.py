"""add is_active to users for account activation/deactivation

Revision ID: p9q0r1s2t3u4
Revises: o8p9q0r1s2t3
Create Date: 2026-08-04

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "p9q0r1s2t3u4"
down_revision: Union[str, Sequence[str], None] = "o8p9q0r1s2t3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_index("ix_users_is_active", "users", ["is_active"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_users_is_active", table_name="users")
    op.drop_column("users", "is_active")
