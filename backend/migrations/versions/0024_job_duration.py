"""tracker: how long the job lasts (full time, or a number of days, months or years, extendable or not)

Revision ID: 0024_job_duration
Revises: 0023_tracker_columns
Create Date: 2026-11-12 14:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0024_job_duration'
down_revision: Union[str, None] = '0023_tracker_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("requirement", sa.Column("duration_type", sa.String(length=12), nullable=True))
    op.add_column("requirement", sa.Column("duration_value", sa.SmallInteger(), nullable=True))
    op.add_column("requirement", sa.Column("duration_unit", sa.String(length=8), nullable=True))
    op.add_column("requirement", sa.Column("duration_extendable", sa.Boolean(), nullable=True))
    op.create_check_constraint("ck_requirement_duration_type", "requirement", "duration_type IS NULL OR duration_type IN ('full_time', 'fixed')")
    op.create_check_constraint("ck_requirement_duration_unit", "requirement", "duration_unit IS NULL OR duration_unit IN ('days', 'months', 'years')")
    op.create_check_constraint("ck_requirement_duration_value", "requirement", "duration_value IS NULL OR duration_value BETWEEN 1 AND 31")


def downgrade() -> None:
    for name in ("ck_requirement_duration_value", "ck_requirement_duration_unit", "ck_requirement_duration_type"):
        op.drop_constraint(name, "requirement", type_="check")
    for column in ("duration_extendable", "duration_unit", "duration_value", "duration_type"):
        op.drop_column("requirement", column)
