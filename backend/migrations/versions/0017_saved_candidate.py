"""saved CVs: which recruiter saved which candidate (one small table, no CV data copied)

Revision ID: 0017_saved_candidate
Revises: 0016_unique_user_email
Create Date: 2026-11-09 21:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0017_saved_candidate'
down_revision: Union[str, None] = '0016_unique_user_email'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "saved_candidate",
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("candidate_id", sa.String(length=36), sa.ForeignKey("candidate.id", ondelete="CASCADE"), nullable=False),
        sa.Column("saved_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("username", "candidate_id"),
    )
    op.create_index("ix_saved_candidate_user_saved", "saved_candidate", ["username", "saved_at"])


def downgrade() -> None:
    op.drop_index("ix_saved_candidate_user_saved", table_name="saved_candidate")
    op.drop_table("saved_candidate")
