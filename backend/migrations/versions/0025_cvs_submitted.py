"""tracker: the day the recruiter submitted CVs, and how many

Revision ID: 0025_cvs_submitted
Revises: 0024_job_duration
Create Date: 2026-11-12 16:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0025_cvs_submitted'
down_revision: Union[str, None] = '0024_job_duration'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("requirement", sa.Column("cvs_submitted_date", sa.Date(), nullable=True))
    op.add_column("requirement", sa.Column("cvs_submitted_count", sa.Integer(), nullable=True))
    op.create_check_constraint("ck_requirement_cvs_submitted", "requirement", "cvs_submitted_count IS NULL OR cvs_submitted_count BETWEEN 0 AND 100000")


def downgrade() -> None:
    op.drop_constraint("ck_requirement_cvs_submitted", "requirement", type_="check")
    op.drop_column("requirement", "cvs_submitted_count")
    op.drop_column("requirement", "cvs_submitted_date")
