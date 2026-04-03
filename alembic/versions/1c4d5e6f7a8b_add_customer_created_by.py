"""add customer created_by

Revision ID: 1c4d5e6f7a8b
Revises: 0b3f6c7d8e9f
Create Date: 2026-04-03

"""

from alembic import op
import sqlalchemy as sa


revision = "1c4d5e6f7a8b"
down_revision = "0b3f6c7d8e9f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("creator_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_customers_creator_id_users",
        "customers",
        "users",
        ["creator_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_customers_creator_id_users", "customers", type_="foreignkey")
    op.drop_column("customers", "creator_id")
