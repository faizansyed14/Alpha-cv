"""PostgreSQL full-text search for the CV search box and boolean search: tsvector columns with GIN indexes replace the trigram LIKE indexes

Revision ID: 0011_fulltext_search
Revises: 0010_scale_indexes
Create Date: 2026-11-06 18:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TSVECTOR


revision: str = '0011_fulltext_search'
down_revision: Union[str, None] = '0010_scale_indexes'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FIELDS = ("text", "literal", "location", "nationality")


def upgrade() -> None:
    pg = op.get_bind().dialect.name == "postgresql"
    for field in FIELDS:
        op.add_column("candidate_search", sa.Column(f"{field}_tsv", TSVECTOR() if pg else sa.Text(), nullable=True))
    if not pg:
        return
    # the 'simple' configuration: words are kept as they are (no stemming, no stop words), which is what the LIKE form matched
    op.execute("UPDATE candidate_search SET " + ", ".join(f"{f}_tsv = to_tsvector('simple', {f})" for f in FIELDS))
    for field in FIELDS:
        op.create_index(f"ix_candidate_search_{field}_fts", "candidate_search", [f"{field}_tsv"], postgresql_using="gin")
    op.execute("DROP INDEX IF EXISTS ix_candidate_search_text_trgm")
    op.execute("DROP INDEX IF EXISTS ix_candidate_search_literal_trgm")


def downgrade() -> None:
    pg = op.get_bind().dialect.name == "postgresql"
    if pg:
        for field in FIELDS:
            op.drop_index(f"ix_candidate_search_{field}_fts", table_name="candidate_search")
        op.execute("CREATE INDEX IF NOT EXISTS ix_candidate_search_text_trgm ON candidate_search USING gin (text gin_trgm_ops)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_candidate_search_literal_trgm ON candidate_search USING gin (literal gin_trgm_ops)")
    for field in FIELDS:
        op.drop_column("candidate_search", f"{field}_tsv")
