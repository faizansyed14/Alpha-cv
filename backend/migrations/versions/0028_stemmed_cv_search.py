"""CV search matches the other forms of a word

A boolean or keyword search for "manage" now finds a CV that says managed, managing or management (and engineer / engineers /
engineering), because the CV words are indexed in a ``cv_english`` text-search configuration: English word forms, and no stop words
(so "IT" or "head of IT" stay searchable). The two word vectors (literal_tsv, extra_tsv) are rewritten for every candidate; names and
places keep the plain configuration. PostgreSQL only: other databases have no text-search vectors.

Revision ID: 0028_stemmed_cv_search
Revises: 0027_requirement_manager
Create Date: 2026-11-12 22:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0028_stemmed_cv_search'
down_revision: Union[str, None] = '0027_requirement_manager'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BATCH = 500
CANDIDATE_COLUMNS = ("id", "raw_text", "full_name", "job_title", "category", "email", "phone", "location", "nationality", "notice_period",
                     "keywords", "languages", "certifications", "skills", "responsibilities")
WORD_TOKENS = "asciiword, word, numword, asciihword, hword, numhword, hword_asciipart, hword_part, hword_numpart"


def _documents(row: dict) -> dict:
    from app.ingestion.search_index import build_search_documents

    return build_search_documents({k: v for k, v in row.items() if k not in ("id", "raw_text")}, row["raw_text"])


def _rewrite(bind, config: str) -> None:
    last = ""
    while True:
        rows = bind.execute(sa.text(f"SELECT {', '.join(CANDIDATE_COLUMNS)} FROM candidate WHERE id > :last ORDER BY id LIMIT {BATCH}"), {"last": last}).mappings().all()
        if not rows:
            return
        for r in rows:
            row = dict(r)
            d = _documents(row)
            bind.execute(sa.text(
                f"UPDATE candidate_search SET literal_tsv = to_tsvector('{config}', :literal), extra_tsv = to_tsvector('{config}', :extra) WHERE candidate_id = :id"),
                {"id": row["id"], "literal": d["literal"], "extra": d["extra"]})
        last = rows[-1]["id"]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_ts_dict WHERE dictname = 'cv_stem') THEN
                CREATE TEXT SEARCH DICTIONARY cv_stem (TEMPLATE = snowball, Language = english);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'cv_english') THEN
                CREATE TEXT SEARCH CONFIGURATION cv_english (COPY = pg_catalog.english);
            END IF;
        END $$;
    """)
    op.execute(f"ALTER TEXT SEARCH CONFIGURATION cv_english ALTER MAPPING FOR {WORD_TOKENS} WITH cv_stem")
    _rewrite(bind, "cv_english")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    _rewrite(bind, "simple")
    op.execute("DROP TEXT SEARCH CONFIGURATION IF EXISTS cv_english")
    op.execute("DROP TEXT SEARCH DICTIONARY IF EXISTS cv_stem")
