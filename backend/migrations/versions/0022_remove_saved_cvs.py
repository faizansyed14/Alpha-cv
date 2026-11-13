"""remove the saved CVs feature: drop the saved_candidate table

Saved CVs (a recruiter's own shortlist, migration 0017) is gone from the application. The table held only who saved which candidate
and when; no CV data was ever copied into it, so dropping it loses no candidate.

Revision ID: 0022_remove_saved_cvs
Revises: 0021_requirement_closures
Create Date: 2026-11-12 10:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0022_remove_saved_cvs'
down_revision: Union[str, None] = '0021_requirement_closures'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "saved_candidate" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_index("ix_saved_candidate_user_saved", table_name="saved_candidate")
        op.drop_table("saved_candidate")


def downgrade() -> None:
    op.create_table(
        "saved_candidate",
        sa.Column("username", sa.String(length=128), primary_key=True),
        sa.Column("candidate_id", sa.String(length=36), sa.ForeignKey("candidate.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("saved_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_saved_candidate_user_saved", "saved_candidate", ["username", "saved_at"])
