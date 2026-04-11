"""add factory tools, tool tracking, machines, machine activities

Revision ID: f1a2b3c4d5e6
Revises: 6382ce8e75aa
Create Date: 2026-04-11

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f1a2b3c4d5e6"
down_revision = "6382ce8e75aa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "factory_tools",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["deleted_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_factory_tools_id"), "factory_tools", ["id"], unique=False)

    op.create_table(
        "tool_tracking_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tool_id", sa.Integer(), nullable=False),
        sa.Column("checkout_at", sa.DateTime(), nullable=False),
        sa.Column("returned_at", sa.DateTime(), nullable=True),
        sa.Column("borrower_name", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["tool_id"], ["factory_tools.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_tool_tracking_records_id"), "tool_tracking_records", ["id"], unique=False)
    op.create_index(op.f("ix_tool_tracking_records_tool_id"), "tool_tracking_records", ["tool_id"], unique=False)
    op.create_index(op.f("ix_tool_tracking_records_checkout_at"), "tool_tracking_records", ["checkout_at"], unique=False)
    op.create_index(op.f("ix_tool_tracking_records_returned_at"), "tool_tracking_records", ["returned_at"], unique=False)

    op.create_table(
        "factory_machines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("machine_name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("serial_number", sa.String(), nullable=True),
        sa.Column("location", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["deleted_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_factory_machines_id"), "factory_machines", ["id"], unique=False)

    op.create_table(
        "machine_activities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("machine_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("message", sa.String(), nullable=True),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["machine_id"], ["factory_machines.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_machine_activities_id"), "machine_activities", ["id"], unique=False)
    op.create_index(op.f("ix_machine_activities_machine_id"), "machine_activities", ["machine_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_machine_activities_machine_id"), table_name="machine_activities")
    op.drop_index(op.f("ix_machine_activities_id"), table_name="machine_activities")
    op.drop_table("machine_activities")
    op.drop_index(op.f("ix_factory_machines_id"), table_name="factory_machines")
    op.drop_table("factory_machines")
    op.drop_index(op.f("ix_tool_tracking_records_returned_at"), table_name="tool_tracking_records")
    op.drop_index(op.f("ix_tool_tracking_records_checkout_at"), table_name="tool_tracking_records")
    op.drop_index(op.f("ix_tool_tracking_records_tool_id"), table_name="tool_tracking_records")
    op.drop_index(op.f("ix_tool_tracking_records_id"), table_name="tool_tracking_records")
    op.drop_table("tool_tracking_records")
    op.drop_index(op.f("ix_factory_tools_id"), table_name="factory_tools")
    op.drop_table("factory_tools")
