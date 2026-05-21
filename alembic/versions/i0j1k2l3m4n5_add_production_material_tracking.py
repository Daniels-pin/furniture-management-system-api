"""add production material tracking tables

Revision ID: i0j1k2l3m4n5
Revises: h9i0j1k2l3m4
Create Date: 2026-05-21

"""

from typing import Sequence, Union
from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision: str = "i0j1k2l3m4n5"
down_revision: Union[str, Sequence[str], None] = "h9i0j1k2l3m4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "production_material_types",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("section", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("default_unit", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("section", "name", name="uq_production_material_types_section_name"),
    )
    op.create_index("ix_production_material_types_section", "production_material_types", ["section"])
    op.create_index("ix_production_material_types_deleted_at", "production_material_types", ["deleted_at"])

    op.create_table(
        "production_material_section_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("section", sa.String(), nullable=False),
        sa.Column("contract_employee_id", sa.Integer(), nullable=False),
        sa.Column("assigned_at", sa.DateTime(), nullable=False),
        sa.Column("assigned_by_id", sa.Integer(), nullable=True),
        sa.Column("removed_at", sa.DateTime(), nullable=True),
        sa.Column("removed_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["assigned_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["contract_employee_id"], ["contract_employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["removed_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "section",
            "contract_employee_id",
            name="uq_production_material_section_assignments_section_employee",
        ),
    )
    op.create_index(
        "ix_production_material_section_assignments_section",
        "production_material_section_assignments",
        ["section"],
    )
    op.create_index(
        "ix_production_material_section_assignments_contract_employee_id",
        "production_material_section_assignments",
        ["contract_employee_id"],
    )
    op.create_index(
        "ix_production_material_section_assignments_removed_at",
        "production_material_section_assignments",
        ["removed_at"],
    )

    op.create_table(
        "production_material_transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("section", sa.String(), nullable=False),
        sa.Column("contract_employee_id", sa.Integer(), nullable=False),
        sa.Column("material_type_id", sa.Integer(), nullable=True),
        sa.Column("material_name", sa.String(), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit", sa.String(), nullable=True),
        sa.Column("txn_type", sa.String(), nullable=False, server_default="allocation"),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("given_by_user_id", sa.Integer(), nullable=True),
        sa.Column("transaction_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("reversal_of_id", sa.Integer(), nullable=True),
        sa.Column("supersedes_id", sa.Integer(), nullable=True),
        sa.Column("superseded_at", sa.DateTime(), nullable=True),
        sa.Column("superseded_by_id", sa.Integer(), nullable=True),
        sa.Column("voided_at", sa.DateTime(), nullable=True),
        sa.Column("voided_by_id", sa.Integer(), nullable=True),
        sa.Column("void_reason", sa.String(length=4000), nullable=True),
        sa.ForeignKeyConstraint(["contract_employee_id"], ["contract_employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["given_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["material_type_id"], ["production_material_types.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reversal_of_id"], ["production_material_transactions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["supersedes_id"], ["production_material_transactions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["superseded_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["voided_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_production_material_transactions_section", "production_material_transactions", ["section"])
    op.create_index(
        "ix_production_material_transactions_contract_employee_id",
        "production_material_transactions",
        ["contract_employee_id"],
    )
    op.create_index(
        "ix_production_material_transactions_material_type_id",
        "production_material_transactions",
        ["material_type_id"],
    )
    op.create_index(
        "ix_production_material_transactions_transaction_at",
        "production_material_transactions",
        ["transaction_at"],
    )
    op.create_index("ix_production_material_transactions_created_at", "production_material_transactions", ["created_at"])
    op.create_index("ix_production_material_transactions_reversal_of_id", "production_material_transactions", ["reversal_of_id"])
    op.create_index("ix_production_material_transactions_supersedes_id", "production_material_transactions", ["supersedes_id"])
    op.create_index("ix_production_material_transactions_superseded_at", "production_material_transactions", ["superseded_at"])
    op.create_index("ix_production_material_transactions_voided_at", "production_material_transactions", ["voided_at"])

    material_types = sa.table(
        "production_material_types",
        sa.column("section", sa.String()),
        sa.column("name", sa.String()),
        sa.column("default_unit", sa.String()),
        sa.column("is_active", sa.Boolean()),
        sa.column("created_at", sa.DateTime()),
    )
    seed_now = datetime.utcnow()
    op.bulk_insert(
        material_types,
        [
            {"section": "painters_dept", "name": "White Paint", "default_unit": "litres", "is_active": True, "created_at": seed_now},
            {"section": "painters_dept", "name": "Thinner", "default_unit": "litres", "is_active": True, "created_at": seed_now},
            {"section": "painters_dept", "name": "Primer", "default_unit": "litres", "is_active": True, "created_at": seed_now},
            {"section": "painters_dept", "name": "Sandpaper", "default_unit": "sheets", "is_active": True, "created_at": seed_now},
            {"section": "mdf_section", "name": "MDF Board", "default_unit": "sheets", "is_active": True, "created_at": seed_now},
            {"section": "mdf_section", "name": "Glue", "default_unit": "litres", "is_active": True, "created_at": seed_now},
            {"section": "mdf_section", "name": "Edge Tape", "default_unit": "rolls", "is_active": True, "created_at": seed_now},
            {"section": "mdf_section", "name": "White Paint", "default_unit": "litres", "is_active": True, "created_at": seed_now},
        ],
    )


def downgrade() -> None:
    op.drop_table("production_material_transactions")
    op.drop_table("production_material_section_assignments")
    op.drop_table("production_material_types")
