"""job_application keeps no match scores (a match is computed on demand and lives in the match result, not in the database)

Revision ID: 0008_drop_match_scores
Revises: 0007_talent_schema
Create Date: 2026-11-06 14:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0008_drop_match_scores'
down_revision: Union[str, None] = '0007_talent_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCORE_COLUMNS = ("match_overall", "match_skills", "match_responsibilities", "match_title", "match_years", "matched_at")


def upgrade() -> None:
    with op.batch_alter_table("job_application") as batch:
        batch.drop_index("ix_job_application_posting_score")
        batch.drop_constraint("ck_job_application_score", type_="check")
        for column in SCORE_COLUMNS:
            batch.drop_column(column)


def downgrade() -> None:
    with op.batch_alter_table("job_application") as batch:
        for column in SCORE_COLUMNS[:-1]:
            batch.add_column(sa.Column(column, sa.Numeric(6, 5), nullable=True))
        batch.add_column(sa.Column("matched_at", sa.DateTime(), nullable=True))
        batch.create_check_constraint("ck_job_application_score", "match_overall IS NULL OR (match_overall >= 0 AND match_overall <= 1)")
        batch.create_index("ix_job_application_posting_score", ["job_posting_id", "match_overall"])
