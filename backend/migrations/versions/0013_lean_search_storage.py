"""PostgreSQL keeps the search text only as tsvectors: the plain copies (text, literal) are emptied and text_tsv is replaced by extra_tsv
(what the AI added to the CV's own words), so a CV costs about a third of the search storage

Revision ID: 0013_lean_search_storage
Revises: 0012_one_tracker
Create Date: 2026-11-09 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TSVECTOR


revision: str = '0013_lean_search_storage'
down_revision: Union[str, None] = '0012_one_tracker'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BATCH = 500
CANDIDATE_COLUMNS = ("id", "raw_text", "full_name", "job_title", "category", "email", "phone", "location", "nationality", "notice_period",
                     "keywords", "languages", "certifications", "skills", "responsibilities")


def _documents(row: dict) -> dict:
    from app.ingestion.search_index import build_search_documents

    return build_search_documents({k: v for k, v in row.items() if k not in ("id", "raw_text")}, row["raw_text"])


def _each_candidate(bind):
    last = ""
    while True:
        rows = bind.execute(sa.text(f"SELECT {', '.join(CANDIDATE_COLUMNS)} FROM candidate WHERE id > :last ORDER BY id LIMIT {BATCH}"), {"last": last}).mappings().all()
        if not rows:
            return
        for r in rows:
            yield dict(r)
        last = rows[-1]["id"]


def upgrade() -> None:
    bind = op.get_bind()
    pg = bind.dialect.name == "postgresql"
    op.add_column("candidate_search", sa.Column("extra_tsv", TSVECTOR() if pg else sa.Text(), nullable=True))
    if pg:
        for row in _each_candidate(bind):
            d = _documents(row)
            bind.execute(sa.text(
                "UPDATE candidate_search SET text = '', literal = '', location = :location, nationality = :nationality, "
                "literal_tsv = to_tsvector('simple', :literal), extra_tsv = to_tsvector('simple', :extra), "
                "location_tsv = to_tsvector('simple', :location), nationality_tsv = to_tsvector('simple', :nationality) WHERE candidate_id = :id"),
                {"id": row["id"], "literal": d["literal"], "extra": d["extra"], "location": d["location"], "nationality": d["nationality"]})
        op.create_index("ix_candidate_search_extra_fts", "candidate_search", ["extra_tsv"], postgresql_using="gin")
        op.execute("DROP INDEX IF EXISTS ix_candidate_search_text_fts")
    with op.batch_alter_table("candidate_search") as batch:
        batch.drop_column("text_tsv")
    # the freed space returns to the operating system with: VACUUM FULL candidate_search  (it locks the table while it runs)


def downgrade() -> None:
    bind = op.get_bind()
    pg = bind.dialect.name == "postgresql"
    op.add_column("candidate_search", sa.Column("text_tsv", TSVECTOR() if pg else sa.Text(), nullable=True))
    if pg:
        for row in _each_candidate(bind):
            d = _documents(row)
            bind.execute(sa.text(
                "UPDATE candidate_search SET text = :text, literal = :literal, text_tsv = to_tsvector('simple', :text) WHERE candidate_id = :id"),
                {"id": row["id"], "text": d["text"], "literal": d["literal"]})
        op.create_index("ix_candidate_search_text_fts", "candidate_search", ["text_tsv"], postgresql_using="gin")
        op.drop_index("ix_candidate_search_extra_fts", table_name="candidate_search")
    with op.batch_alter_table("candidate_search") as batch:
        batch.drop_column("extra_tsv")
