"""add employees hr tables

Revision ID: b7c8d9e0f1a3
Revises: a9d688baa04a
Create Date: 2026-04-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7c8d9e0f1a3"
down_revision: Union[str, Sequence[str], None] = "a9d688baa04a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "employees",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("full_name", sa.String(), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("account_number", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("base_salary", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("documents", sa.JSON(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_employees_id"), "employees", ["id"], unique=False)
    op.create_index(op.f("ix_employees_user_id"), "employees", ["user_id"], unique=True)

    op.create_table(
        "employee_lateness_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_employee_lateness_entries_id"), "employee_lateness_entries", ["id"], unique=False)
    op.create_index(
        op.f("ix_employee_lateness_entries_employee_id"),
        "employee_lateness_entries",
        ["employee_id"],
        unique=False,
    )

    op.create_table(
        "employee_penalties",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_employee_penalties_id"), "employee_penalties", ["id"], unique=False)
    op.create_index(op.f("ix_employee_penalties_employee_id"), "employee_penalties", ["employee_id"], unique=False)

    op.create_table(
        "employee_bonuses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_employee_bonuses_id"), "employee_bonuses", ["id"], unique=False)
    op.create_index(op.f("ix_employee_bonuses_employee_id"), "employee_bonuses", ["employee_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_employee_bonuses_employee_id"), table_name="employee_bonuses")
    op.drop_index(op.f("ix_employee_bonuses_id"), table_name="employee_bonuses")
    op.drop_table("employee_bonuses")
    op.drop_index(op.f("ix_employee_penalties_employee_id"), table_name="employee_penalties")
    op.drop_index(op.f("ix_employee_penalties_id"), table_name="employee_penalties")
    op.drop_table("employee_penalties")
    op.drop_index(op.f("ix_employee_lateness_entries_employee_id"), table_name="employee_lateness_entries")
    op.drop_index(op.f("ix_employee_lateness_entries_id"), table_name="employee_lateness_entries")
    op.drop_table("employee_lateness_entries")
    op.drop_index(op.f("ix_employees_user_id"), table_name="employees")
    op.drop_index(op.f("ix_employees_id"), table_name="employees")
    op.drop_table("employees")
