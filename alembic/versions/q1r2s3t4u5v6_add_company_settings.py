"""add company settings singleton table

Revision ID: q1r2s3t4u5v6
Revises: p9q0r1s2t3u4
Create Date: 2026-08-27

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "q1r2s3t4u5v6"
down_revision: Union[str, Sequence[str], None] = "p9q0r1s2t3u4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "company_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("rc_number", sa.String(length=100), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_company_settings_id"), "company_settings", ["id"], unique=False)
    op.execute(sa.text("INSERT INTO company_settings (id, rc_number) VALUES (1, NULL)"))


def downgrade() -> None:
    op.drop_index(op.f("ix_company_settings_id"), table_name="company_settings")
    op.drop_table("company_settings")
