"""add employee absence entries

Revision ID: c4e5f6a7b8d9
Revises: ab13c7d9e210
Create Date: 2026-05-18

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4e5f6a7b8d9"
down_revision: Union[str, Sequence[str], None] = "ab13c7d9e210"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "employee_absence_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("period_id", sa.Integer(), nullable=False),
        sa.Column("absence_date", sa.Date(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("voided_at", sa.DateTime(), nullable=True),
        sa.Column("voided_by_id", sa.Integer(), nullable=True),
        sa.Column("void_reason", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["period_id"], ["salary_periods.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["voided_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", "absence_date", name="uq_employee_absence_emp_date"),
    )
    op.create_index(op.f("ix_employee_absence_entries_id"), "employee_absence_entries", ["id"], unique=False)
    op.create_index(
        op.f("ix_employee_absence_entries_employee_id"),
        "employee_absence_entries",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_absence_entries_period_id"),
        "employee_absence_entries",
        ["period_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_absence_entries_absence_date"),
        "employee_absence_entries",
        ["absence_date"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_absence_entries_voided_at"),
        "employee_absence_entries",
        ["voided_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_employee_absence_entries_voided_at"), table_name="employee_absence_entries")
    op.drop_index(op.f("ix_employee_absence_entries_absence_date"), table_name="employee_absence_entries")
    op.drop_index(op.f("ix_employee_absence_entries_period_id"), table_name="employee_absence_entries")
    op.drop_index(op.f("ix_employee_absence_entries_employee_id"), table_name="employee_absence_entries")
    op.drop_index(op.f("ix_employee_absence_entries_id"), table_name="employee_absence_entries")
    op.drop_table("employee_absence_entries")
