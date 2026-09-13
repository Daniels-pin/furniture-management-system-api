"""add field visits table

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7
Create Date: 2026-09-13

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "s3t4u5v6w7x8"
down_revision: Union[str, Sequence[str], None] = "r2s3t4u5v6w7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "field_visits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("visit_number", sa.String(length=32), nullable=False),
        sa.Column("visit_at", sa.DateTime(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("project_name", sa.String(length=500), nullable=False),
        sa.Column("project_location", sa.String(length=500), nullable=False),
        sa.Column("project_type", sa.String(length=100), nullable=False),
        sa.Column("estimated_units", sa.String(length=200), nullable=True),
        sa.Column("project_stage", sa.String(length=100), nullable=False),
        sa.Column("developer_owner", sa.String(length=300), nullable=True),
        sa.Column("contractor", sa.String(length=300), nullable=True),
        sa.Column("architect_designer", sa.String(length=300), nullable=True),
        sa.Column("decision_maker", sa.String(length=300), nullable=True),
        sa.Column("phone_number", sa.String(length=80), nullable=False),
        sa.Column("whatsapp_number", sa.String(length=80), nullable=True),
        sa.Column("furniture_needed", sa.JSON(), nullable=False),
        sa.Column("boq_available", sa.String(length=10), nullable=False),
        sa.Column("estimated_opportunity_value", sa.Numeric(14, 2), nullable=True),
        sa.Column("existing_supplier", sa.String(length=300), nullable=True),
        sa.Column("visit_outcome", sa.String(length=100), nullable=False),
        sa.Column("visit_outcome_other", sa.String(length=2000), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("photo_urls", sa.JSON(), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["employee_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("visit_number"),
    )
    op.create_index("ix_field_visits_visit_number", "field_visits", ["visit_number"])
    op.create_index("ix_field_visits_visit_at", "field_visits", ["visit_at"])
    op.create_index("ix_field_visits_employee_id", "field_visits", ["employee_id"])
    op.create_index("ix_field_visits_project_location", "field_visits", ["project_location"])
    op.create_index("ix_field_visits_project_type", "field_visits", ["project_type"])
    op.create_index("ix_field_visits_decision_maker", "field_visits", ["decision_maker"])
    op.create_index("ix_field_visits_phone_number", "field_visits", ["phone_number"])
    op.create_index("ix_field_visits_visit_outcome", "field_visits", ["visit_outcome"])
    op.create_index("ix_field_visits_created_by_id", "field_visits", ["created_by_id"])
    op.create_index("ix_field_visits_created_at", "field_visits", ["created_at"])
    op.create_index("ix_field_visits_deleted_at", "field_visits", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_field_visits_deleted_at", table_name="field_visits")
    op.drop_index("ix_field_visits_created_at", table_name="field_visits")
    op.drop_index("ix_field_visits_created_by_id", table_name="field_visits")
    op.drop_index("ix_field_visits_visit_outcome", table_name="field_visits")
    op.drop_index("ix_field_visits_phone_number", table_name="field_visits")
    op.drop_index("ix_field_visits_decision_maker", table_name="field_visits")
    op.drop_index("ix_field_visits_project_type", table_name="field_visits")
    op.drop_index("ix_field_visits_project_location", table_name="field_visits")
    op.drop_index("ix_field_visits_employee_id", table_name="field_visits")
    op.drop_index("ix_field_visits_visit_at", table_name="field_visits")
    op.drop_index("ix_field_visits_visit_number", table_name="field_visits")
    op.drop_table("field_visits")
