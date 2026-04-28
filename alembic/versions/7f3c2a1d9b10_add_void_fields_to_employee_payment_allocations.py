"""add void fields to employee_payment_allocations

Revision ID: 7f3c2a1d9b10
Revises: b17f1dc314b0
Create Date: 2026-04-28

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "7f3c2a1d9b10"
down_revision: Union[str, Sequence[str], None] = "b17f1dc314b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("employee_payment_allocations", sa.Column("voided_at", sa.DateTime(), nullable=True))
    op.add_column("employee_payment_allocations", sa.Column("voided_by_id", sa.Integer(), nullable=True))
    op.add_column("employee_payment_allocations", sa.Column("void_reason", sa.String(length=4000), nullable=True))
    op.create_index(op.f("ix_employee_payment_allocations_voided_at"), "employee_payment_allocations", ["voided_at"], unique=False)
    op.create_index(op.f("ix_employee_payment_allocations_voided_by_id"), "employee_payment_allocations", ["voided_by_id"], unique=False)
    op.create_foreign_key(
        "fk_employee_payment_allocations_voided_by_id_users",
        "employee_payment_allocations",
        "users",
        ["voided_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_employee_payment_allocations_voided_by_id_users", "employee_payment_allocations", type_="foreignkey")
    op.drop_index(op.f("ix_employee_payment_allocations_voided_by_id"), table_name="employee_payment_allocations")
    op.drop_index(op.f("ix_employee_payment_allocations_voided_at"), table_name="employee_payment_allocations")
    op.drop_column("employee_payment_allocations", "void_reason")
    op.drop_column("employee_payment_allocations", "voided_by_id")
    op.drop_column("employee_payment_allocations", "voided_at")

