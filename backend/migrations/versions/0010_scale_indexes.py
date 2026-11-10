"""indexes for millions of rows: the newest-first order (uploaded_at, id) that every list and search pages by, and trigram search on
job description titles

Revision ID: 0010_scale_indexes
Revises: 0009_lists_as_columns
Create Date: 2026-11-06 17:00:00
"""
from typing import Sequence, Union

from alembic import op


revision: str = '0010_scale_indexes'
down_revision: Union[str, None] = '0009_lists_as_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_candidate_uploaded_at", table_name="candidate")
    op.create_index("ix_candidate_uploaded_at", "candidate", ["uploaded_at", "id"])
    op.drop_index("ix_candidate_category_uploaded", table_name="candidate")
    op.create_index("ix_candidate_category_uploaded", "candidate", ["category", "uploaded_at", "id"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        op.execute("CREATE INDEX IF NOT EXISTS ix_job_description_title_trgm ON job_description USING gin (lower(coalesce(job_title, '')) gin_trgm_ops)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_job_description_filename_trgm ON job_description USING gin (lower(coalesce(original_filename, '')) gin_trgm_ops)")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_job_description_filename_trgm")
        op.execute("DROP INDEX IF EXISTS ix_job_description_title_trgm")
    op.drop_index("ix_candidate_category_uploaded", table_name="candidate")
    op.create_index("ix_candidate_category_uploaded", "candidate", ["category", "uploaded_at"])
    op.drop_index("ix_candidate_uploaded_at", table_name="candidate")
    op.create_index("ix_candidate_uploaded_at", "candidate", ["uploaded_at"])
