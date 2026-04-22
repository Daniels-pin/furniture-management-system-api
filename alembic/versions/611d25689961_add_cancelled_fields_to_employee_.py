"""add_cancelled_fields_to_employee_transactions

Revision ID: 611d25689961
Revises: 7a1d9c2e4f6b
Create Date: 2026-04-22 14:33:23.302615

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '611d25689961'
down_revision: Union[str, Sequence[str], None] = '7a1d9c2e4f6b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("employee_transactions", sa.Column("cancelled_at", sa.DateTime(), nullable=True))
    op.add_column("employee_transactions", sa.Column("cancelled_by_id", sa.Integer(), nullable=True))
    op.add_column("employee_transactions", sa.Column("cancelled_reason", sa.String(length=4000), nullable=True))

    op.create_index(op.f("ix_employee_transactions_cancelled_at"), "employee_transactions", ["cancelled_at"], unique=False)
    op.create_index(op.f("ix_employee_transactions_cancelled_by_id"), "employee_transactions", ["cancelled_by_id"], unique=False)

    op.create_foreign_key(
        "fk_employee_transactions_cancelled_by_id_users",
        "employee_transactions",
        "users",
        ["cancelled_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_employee_transactions_cancelled_by_id_users", "employee_transactions", type_="foreignkey")
    op.drop_index(op.f("ix_employee_transactions_cancelled_by_id"), table_name="employee_transactions")
    op.drop_index(op.f("ix_employee_transactions_cancelled_at"), table_name="employee_transactions")
    op.drop_column("employee_transactions", "cancelled_reason")
    op.drop_column("employee_transactions", "cancelled_by_id")
    op.drop_column("employee_transactions", "cancelled_at")
