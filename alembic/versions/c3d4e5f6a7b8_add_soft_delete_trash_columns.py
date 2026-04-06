"""add soft delete (trash) columns to core entities

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-06

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = (
        "orders",
        "customers",
        "invoices",
        "products",
        "proforma_invoices",
        "quotations",
        "waybills",
    )
    for t in tables:
        op.add_column(t, sa.Column("deleted_at", sa.DateTime(), nullable=True))
        op.add_column(t, sa.Column("deleted_by_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            f"fk_{t}_deleted_by_id_users",
            t,
            "users",
            ["deleted_by_id"],
            ["id"],
        )


def downgrade() -> None:
    tables = (
        "waybills",
        "quotations",
        "proforma_invoices",
        "products",
        "invoices",
        "customers",
        "orders",
    )
    for t in tables:
        op.drop_constraint(f"fk_{t}_deleted_by_id_users", t, type_="foreignkey")
        op.drop_column(t, "deleted_by_id")
        op.drop_column(t, "deleted_at")
