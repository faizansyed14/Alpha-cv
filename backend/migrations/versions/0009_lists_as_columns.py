"""a candidate and a job description are one row each: their lists become array columns (the id is stored once, not once per item);
cover letter, experience warning, company name and additional info are dropped (they were never filled)

Revision ID: 0009_lists_as_columns
Revises: 0008_drop_match_scores
Create Date: 2026-11-06 15:00:00
"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0009_lists_as_columns'
down_revision: Union[str, None] = '0008_drop_match_scores'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (table, owner column, array column, source table, source column, order by)
LISTS = (
    ("candidate", "candidate_id", "skills", "candidate_skill", "text", "position"),
    ("candidate", "candidate_id", "responsibilities", "candidate_responsibility", "text", "position"),
    ("candidate", "candidate_id", "keywords", "candidate_keyword", "keyword", "keyword"),
    ("candidate", "candidate_id", "languages", "candidate_language", "language", "language"),
    ("candidate", "candidate_id", "certifications", "candidate_certification", "name", "name"),
    ("job_description", "job_description_id", "skills", "job_description_skill", "text", "position"),
    ("job_description", "job_description_id", "responsibilities", "job_description_responsibility", "text", "position"),
)


def _postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    pg = _postgres()
    kind = sa.ARRAY(sa.Text()) if pg else sa.JSON()
    for table, _owner, column, *_ in LISTS:
        op.add_column(table, sa.Column(column, kind, nullable=True))

    bind = op.get_bind()
    for table, owner, column, source, value, order in LISTS:
        if pg:
            op.execute(f"UPDATE {table} t SET {column} = ARRAY(SELECT s.{value} FROM {source} s WHERE s.{owner} = t.id ORDER BY s.{order})")
        else:
            lists = {}
            for row in bind.execute(sa.text(f"SELECT {owner}, {value} FROM {source} ORDER BY {owner}, {order}")):
                lists.setdefault(row[0], []).append(row[1])
            for key, items in lists.items():
                bind.execute(sa.text(f"UPDATE {table} SET {column} = :v WHERE id = :i"), {"v": json.dumps(items), "i": key})
            bind.execute(sa.text(f"UPDATE {table} SET {column} = '[]' WHERE {column} IS NULL"))

    with op.batch_alter_table("candidate") as batch:
        for column in ("skills", "responsibilities", "keywords", "languages", "certifications"):
            batch.alter_column(column, existing_type=kind, nullable=False)
    with op.batch_alter_table("job_description") as batch:
        for column in ("skills", "responsibilities"):
            batch.alter_column(column, existing_type=kind, nullable=False)

    for table in ("candidate_skill", "candidate_responsibility", "candidate_keyword", "candidate_language", "candidate_certification",
                  "job_description_skill", "job_description_responsibility"):
        op.drop_table(table)

    if pg:
        op.create_index("ix_candidate_languages", "candidate", ["languages"], postgresql_using="gin")
        op.create_index("ix_candidate_keywords", "candidate", ["keywords"], postgresql_using="gin")
    else:
        op.create_index("ix_candidate_languages", "candidate", ["languages"])
        op.create_index("ix_candidate_keywords", "candidate", ["keywords"])

    with op.batch_alter_table("job_application") as batch:
        batch.drop_column("cover_letter")
        batch.drop_column("experience_warning")
    with op.batch_alter_table("job_posting") as batch:
        batch.drop_column("company_name")
        batch.drop_column("additional_info")


def downgrade() -> None:
    if not _postgres():
        raise NotImplementedError("downgrade is supported on PostgreSQL only")
    with op.batch_alter_table("job_posting") as batch:
        batch.add_column(sa.Column("company_name", sa.String(256), nullable=True))
        batch.add_column(sa.Column("additional_info", sa.Text(), nullable=True))
    with op.batch_alter_table("job_application") as batch:
        batch.add_column(sa.Column("cover_letter", sa.Text(), nullable=True))
        batch.add_column(sa.Column("experience_warning", sa.JSON(), nullable=True))
    op.drop_index("ix_candidate_keywords", table_name="candidate")
    op.drop_index("ix_candidate_languages", table_name="candidate")

    def child(name, owner_table, owner, value_column, value_type, ordered):
        cols = [sa.Column(owner, sa.String(36), nullable=False)]
        if ordered:
            cols.append(sa.Column("position", sa.SmallInteger(), nullable=False))
        cols.append(sa.Column(value_column, value_type, nullable=False))
        cols.append(sa.ForeignKeyConstraint([owner], [f"{owner_table}.id"], ondelete="CASCADE"))
        cols.append(sa.PrimaryKeyConstraint(owner, "position" if ordered else value_column))
        op.create_table(name, *cols)

    for table, owner, column, source, value, order in LISTS:
        ordered = order == "position"
        value_type = {"keyword": sa.String(128), "language": sa.String(64), "name": sa.String(256)}.get(value, sa.Text())
        child(source, table, owner, value, value_type, ordered)
        if ordered:
            op.execute(f"INSERT INTO {source} ({owner}, position, {value}) "
                       f"SELECT t.id, (u.n - 1)::smallint, u.v FROM {table} t, unnest(t.{column}) WITH ORDINALITY AS u(v, n)")
        else:
            op.execute(f"INSERT INTO {source} ({owner}, {value}) SELECT DISTINCT t.id, u.v FROM {table} t, unnest(t.{column}) AS u(v)")
    op.create_index("ix_candidate_keyword_lower", "candidate_keyword", [sa.literal_column("lower(keyword)")])
    op.create_index("ix_candidate_language_language", "candidate_language", ["language"])
    op.create_index("ix_candidate_certification_name", "candidate_certification", ["name"])
    for table, columns in (("candidate", ("skills", "responsibilities", "keywords", "languages", "certifications")),
                           ("job_description", ("skills", "responsibilities"))):
        for column in columns:
            op.drop_column(table, column)
