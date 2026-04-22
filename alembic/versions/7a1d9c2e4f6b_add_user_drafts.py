"""add user drafts

Revision ID: 7a1d9c2e4f6b
Revises: 3b8c1d2e4f5a
Create Date: 2026-04-22

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "7a1d9c2e4f6b"
down_revision = "3b8c1d2e4f5a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "drafts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module", sa.String(length=64), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "module", name="uq_drafts_user_module"),
    )
    op.create_index("ix_drafts_user_id", "drafts", ["user_id"])
    op.create_index("ix_drafts_module", "drafts", ["module"])
    op.create_index("ix_drafts_created_at", "drafts", ["created_at"])
    op.create_index("ix_drafts_updated_at", "drafts", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_drafts_updated_at", table_name="drafts")
    op.drop_index("ix_drafts_created_at", table_name="drafts")
    op.drop_index("ix_drafts_module", table_name="drafts")
    op.drop_index("ix_drafts_user_id", table_name="drafts")
    op.drop_table("drafts")

