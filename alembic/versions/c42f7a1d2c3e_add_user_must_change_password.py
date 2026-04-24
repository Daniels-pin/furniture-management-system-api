"""add user must_change_password

Revision ID: c42f7a1d2c3e
Revises: b17f1dc314b0
Create Date: 2026-04-24

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c42f7a1d2c3e"
down_revision: Union[str, Sequence[str], None] = "b17f1dc314b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(), nullable=True))
    op.create_index("ix_users_must_change_password", "users", ["must_change_password"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_users_must_change_password", table_name="users")
    op.drop_column("users", "password_changed_at")
    op.drop_column("users", "must_change_password")

