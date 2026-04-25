"""sync contract employee owed semantics

Revision ID: d05261d4a17d
Revises: 4c91d8a2b7f1
Create Date: 2026-04-25 11:46:43.468936

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd05261d4a17d'
down_revision: Union[str, Sequence[str], None] = '4c91d8a2b7f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Align contract employee totals with the new invariant:

    - contract_employees.total_owed == live/net owed (can be negative)
    - contract_employees.balance is kept equal to total_owed for backward compatibility

    Historically:
    - total_owed was gross job value (+ adjustments)
    - balance was net owed (total_owed - total_paid)

    We migrate by setting total_owed := balance for all existing rows.
    """
    op.execute(
        sa.text(
            """
            UPDATE contract_employees
            SET total_owed = COALESCE(balance, 0),
                balance = COALESCE(balance, 0)
            """
        )
    )


def downgrade() -> None:
    """Downgrade schema.

    Best-effort: reconstruct legacy gross total_owed as (balance + total_paid).
    """
    op.execute(
        sa.text(
            """
            UPDATE contract_employees
            SET total_owed = COALESCE(balance, 0) + COALESCE(total_paid, 0),
                balance = COALESCE(balance, 0)
            """
        )
    )
