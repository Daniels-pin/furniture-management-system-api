"""add contract job description

Revision ID: d2c6a1f4d0a1
Revises: b17f1dc314b0
Create Date: 2026-04-24

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d2c6a1f4d0a1"
down_revision: Union[str, Sequence[str], None] = "b17f1dc314b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Non-null with server_default so existing rows get a safe value.
    op.add_column(
        "contract_jobs",
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("contract_jobs", "description")

