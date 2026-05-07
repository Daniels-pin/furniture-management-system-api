"""add_soft_delete_to_employees

Revision ID: e3a1b2c4d5f6
Revises: 0d7a2c9e1b33
Create Date: 2026-05-07 10:28:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e3a1b2c4d5f6"
down_revision: Union[str, Sequence[str], None] = "0d7a2c9e1b33"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("employees", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    op.add_column("employees", sa.Column("deleted_by_id", sa.Integer(), nullable=True))

    op.create_index(op.f("ix_employees_deleted_at"), "employees", ["deleted_at"], unique=False)
    op.create_index(op.f("ix_employees_deleted_by_id"), "employees", ["deleted_by_id"], unique=False)

    op.create_foreign_key(
        "fk_employees_deleted_by_id_users",
        "employees",
        "users",
        ["deleted_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_employees_deleted_by_id_users", "employees", type_="foreignkey")
    op.drop_index(op.f("ix_employees_deleted_by_id"), table_name="employees")
    op.drop_index(op.f("ix_employees_deleted_at"), table_name="employees")
    op.drop_column("employees", "deleted_by_id")
    op.drop_column("employees", "deleted_at")

