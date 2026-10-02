"""add monotonic document number sequences

Revision ID: t4u5v6w7x8y9
Revises: s3t4u5v6w7x8
Create Date: 2026-10-02

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "t4u5v6w7x8y9"
down_revision: Union[str, Sequence[str], None] = "s3t4u5v6w7x8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _max_suffix(table: str, column: str, prefix: str) -> int:
    bind = op.get_bind()
    rows = bind.execute(sa.text(f"SELECT {column} FROM {table}")).fetchall()
    head = f"{prefix.upper()}-"
    max_seq = 0
    for (raw,) in rows:
        text = (raw or "").strip().upper()
        if not text.startswith(head):
            continue
        tail = text[len(head) :].strip()
        try:
            max_seq = max(max_seq, int(tail, 10))
        except ValueError:
            continue
    return max_seq


def upgrade() -> None:
    op.create_table(
        "document_number_sequences",
        sa.Column("name", sa.String(length=32), primary_key=True),
        sa.Column("last_value", sa.Integer(), nullable=False),
    )
    quotation_floor = _max_suffix("quotations", "quote_number", "QUO")
    proforma_floor = _max_suffix("proforma_invoices", "proforma_number", "PROF")
    invoice_floor = _max_suffix("invoices", "invoice_number", "INV")
    waybill_floor = _max_suffix("waybills", "waybill_number", "WB")
    op.bulk_insert(
        sa.table(
            "document_number_sequences",
            sa.column("name", sa.String),
            sa.column("last_value", sa.Integer),
        ),
        [
            {"name": "quotation", "last_value": quotation_floor},
            {"name": "proforma", "last_value": proforma_floor},
            {"name": "invoice", "last_value": invoice_floor},
            {"name": "waybill", "last_value": waybill_floor},
        ],
    )


def downgrade() -> None:
    op.drop_table("document_number_sequences")
