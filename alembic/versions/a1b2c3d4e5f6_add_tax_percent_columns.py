"""add tax_percent to orders, proforma_invoices, quotations

Revision ID: a1b2c3d4e5f6
Revises: 4f8a9b0c1d2e
Create Date: 2026-04-04

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "4f8a9b0c1d2e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("tax_percent", sa.Numeric(8, 4), nullable=True))
    op.add_column("proforma_invoices", sa.Column("tax_percent", sa.Numeric(8, 4), nullable=True))
    op.add_column("quotations", sa.Column("tax_percent", sa.Numeric(8, 4), nullable=True))

    # Infer historical rate from stored monetary tax / post-discount base, then recompute tax from that rate.
    for table in ("orders", "proforma_invoices", "quotations"):
        op.execute(
            sa.text(
                f"""
                UPDATE {table}
                SET tax_percent = ROUND(
                    CAST(tax AS NUMERIC) / NULLIF(CAST(final_price AS NUMERIC), 0) * 100,
                    4
                )
                WHERE tax IS NOT NULL
                  AND final_price IS NOT NULL
                  AND CAST(final_price AS NUMERIC) > 0
                """
            )
        )
        op.execute(
            sa.text(
                f"""
                UPDATE {table}
                SET tax = ROUND(
                    CAST(final_price AS NUMERIC) * CAST(tax_percent AS NUMERIC) / 100,
                    2
                )
                WHERE tax_percent IS NOT NULL
                  AND final_price IS NOT NULL
                """
            )
        )


def downgrade() -> None:
    op.drop_column("quotations", "tax_percent")
    op.drop_column("proforma_invoices", "tax_percent")
    op.drop_column("orders", "tax_percent")
