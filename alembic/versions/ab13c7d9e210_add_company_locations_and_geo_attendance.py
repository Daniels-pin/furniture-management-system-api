"""add company locations and geo attendance

Revision ID: ab13c7d9e210
Revises: f2c3d4e5f6a8
Create Date: 2026-05-13

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "ab13c7d9e210"
down_revision: Union[str, Sequence[str], None] = "f2c3d4e5f6a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "company_locations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("allowed_radius_meters", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_company_locations_name"),
    )
    op.create_index(op.f("ix_company_locations_id"), "company_locations", ["id"], unique=False)
    op.create_index(op.f("ix_company_locations_name"), "company_locations", ["name"], unique=False)

    op.add_column("employees", sa.Column("work_location_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_employees_work_location_id"), "employees", ["work_location_id"], unique=False)
    op.create_foreign_key(
        "fk_employees_work_location",
        "employees",
        "company_locations",
        ["work_location_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column("employee_attendance_entries", sa.Column("work_location_id", sa.Integer(), nullable=True))
    op.add_column("employee_attendance_entries", sa.Column("employee_latitude", sa.Float(), nullable=True))
    op.add_column("employee_attendance_entries", sa.Column("employee_longitude", sa.Float(), nullable=True))
    op.add_column("employee_attendance_entries", sa.Column("distance_meters", sa.Float(), nullable=True))
    op.create_index(
        op.f("ix_employee_attendance_entries_work_location_id"),
        "employee_attendance_entries",
        ["work_location_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_employee_attendance_entries_work_location",
        "employee_attendance_entries",
        "company_locations",
        ["work_location_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_employee_attendance_entries_work_location",
        "employee_attendance_entries",
        type_="foreignkey",
    )
    op.drop_index(op.f("ix_employee_attendance_entries_work_location_id"), table_name="employee_attendance_entries")
    op.drop_column("employee_attendance_entries", "distance_meters")
    op.drop_column("employee_attendance_entries", "employee_longitude")
    op.drop_column("employee_attendance_entries", "employee_latitude")
    op.drop_column("employee_attendance_entries", "work_location_id")

    op.drop_constraint("fk_employees_work_location", "employees", type_="foreignkey")
    op.drop_index(op.f("ix_employees_work_location_id"), table_name="employees")
    op.drop_column("employees", "work_location_id")

    op.drop_index(op.f("ix_company_locations_name"), table_name="company_locations")
    op.drop_index(op.f("ix_company_locations_id"), table_name="company_locations")
    op.drop_table("company_locations")

