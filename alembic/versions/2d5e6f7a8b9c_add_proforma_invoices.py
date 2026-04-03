"""add proforma invoices

Revision ID: 2d5e6f7a8b9c
Revises: 1c4d5e6f7a8b
Create Date: 2026-04-03

"""

from alembic import op
import sqlalchemy as sa


revision = "2d5e6f7a8b9c"
down_revision = "1c4d5e6f7a8b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "proforma_invoices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("proforma_number", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("customer_name", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=False),
        sa.Column("address", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id"), nullable=True),
        sa.Column("discount_type", sa.String(), nullable=True),
        sa.Column("discount_value", sa.Numeric(11, 2), nullable=True),
        sa.Column("discount_amount", sa.Numeric(11, 2), nullable=True),
        sa.Column("tax", sa.Numeric(11, 2), nullable=True),
        sa.Column("subtotal", sa.Numeric(11, 2), nullable=True),
        sa.Column("final_price", sa.Numeric(11, 2), nullable=True),
        sa.Column("grand_total", sa.Numeric(11, 2), nullable=True),
        sa.Column("due_date", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("converted_order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=True),
    )
    op.create_index("ix_proforma_invoices_proforma_number", "proforma_invoices", ["proforma_number"], unique=True)
    op.create_index("ix_proforma_invoices_status", "proforma_invoices", ["status"])

    op.create_table(
        "proforma_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("proforma_id", sa.Integer(), sa.ForeignKey("proforma_invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(11, 2), nullable=True),
    )
    op.create_index("ix_proforma_items_proforma_id", "proforma_items", ["proforma_id"])


def downgrade() -> None:
    op.drop_index("ix_proforma_items_proforma_id", table_name="proforma_items")
    op.drop_table("proforma_items")
    op.drop_index("ix_proforma_invoices_status", table_name="proforma_invoices")
    op.drop_index("ix_proforma_invoices_proforma_number", table_name="proforma_invoices")
    op.drop_table("proforma_invoices")
