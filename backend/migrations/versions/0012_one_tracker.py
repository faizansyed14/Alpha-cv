"""one set of tracker tables for both teams: every tracker row gets a ``team`` and the Abu Dhabi copies (tracker_*_ad) are merged in

Revision ID: 0012_one_tracker
Revises: 0011_fulltext_search
Create Date: 2026-11-06 20:00:00
"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0012_one_tracker'
down_revision: Union[str, None] = '0011_fulltext_search'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# parents first: an application points at a candidate and a job opening
TABLES = ("tracker_option", "tracker_job_opening", "tracker_candidate", "tracker_application", "tracker_follow_up")


def upgrade() -> None:
    bind = op.get_bind()
    for table in TABLES:
        op.add_column(table, sa.Column("team", sa.String(length=16), nullable=False, server_default="dubai"))
        op.create_index(f"ix_{table}_team", table, ["team"])

    present = set(sa.inspect(bind).get_table_names())
    meta = sa.MetaData()
    new_id = {}                                   # (table, id in the _ad table) -> id in the merged table
    for table in TABLES:
        copy = f"{table}_ad"
        if copy not in present:
            continue
        main = sa.Table(table, meta, autoload_with=bind)
        ad = sa.Table(copy, meta, autoload_with=bind)
        taken = {r[0] for r in bind.execute(sa.select(main.c.id))}
        rows = []
        for r in bind.execute(sa.select(ad)):
            row = dict(r._mapping)
            old = row["id"]
            row["id"] = old if old not in taken else str(uuid.uuid4())      # the old bootstrap copied rows with the same ids
            taken.add(row["id"])
            new_id[(table, old)] = row["id"]
            row["team"] = "abudhabi"
            if table == "tracker_application":
                row["candidate_id"] = new_id.get(("tracker_candidate", row["candidate_id"]), row["candidate_id"])
                if row.get("job_opening_id"):
                    row["job_opening_id"] = new_id.get(("tracker_job_opening", row["job_opening_id"]), row["job_opening_id"])
            rows.append(row)
        if rows:
            bind.execute(main.insert(), rows)
    for table in reversed(TABLES):
        if f"{table}_ad" in present:
            op.drop_table(f"{table}_ad")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        raise NotImplementedError("downgrade is supported on PostgreSQL only")
    for table in TABLES:
        op.execute(f'CREATE TABLE "{table}_ad" (LIKE "{table}" INCLUDING ALL)')
        op.execute(f'INSERT INTO "{table}_ad" SELECT * FROM "{table}" WHERE team = \'abudhabi\'')
    for table in reversed(TABLES):
        op.execute(f'DELETE FROM "{table}" WHERE team = \'abudhabi\'')
    for table in TABLES:
        op.drop_index(f"ix_{table}_team", table_name=table)
        op.drop_column(table, "team")
        op.drop_column(f"{table}_ad", "team")
