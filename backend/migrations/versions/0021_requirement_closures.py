"""requirement closures: when a requirement was closed and by whom

A requirement that is closed leaves the recruiters' lists and appears on the Closures page, credited to its recruiter. Requirements already
closed get the time of their last update as the time they were closed.

Revision ID: 0021_requirement_closures
Revises: 0020_requirement_tracker
Create Date: 2026-11-11 18:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0021_requirement_closures'
down_revision: Union[str, None] = '0020_requirement_tracker'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("requirement", sa.Column("closed_at", sa.DateTime(), nullable=True))
    op.add_column("requirement", sa.Column("closed_by", sa.String(length=64), nullable=True))
    op.execute("UPDATE requirement SET closed_at = updated_at, closed_by = updated_by WHERE status = 'closed'")
    op.create_index("ix_requirement_closed", "requirement", ["status", "closed_at"])


def downgrade() -> None:
    op.drop_index("ix_requirement_closed", table_name="requirement")
    op.drop_column("requirement", "closed_by")
    op.drop_column("requirement", "closed_at")
