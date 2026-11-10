#!/usr/bin/env python3
"""Read-only audit of the two stores: do Postgres and Qdrant agree (every row has its vector point and the other way round, no payloads),
is everything embedded and indexed, are there duplicates or dangling links. Run it where the backend runs:

    docker compose exec backend python /app/../scripts/db/audit_stores.py      # or: python scripts/db/audit_stores.py with the backend's environment set

It changes nothing.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))
sys.path.insert(0, "/app")
from sqlalchemy import text
from app.config.settings import settings
from app.db.database import engine
from app.store import get_store
from app.store.vectors import collection_name

store = get_store()
client = store.vectors.client


def points(kind):
    ids, offset = set(), None
    while True:
        res, offset = client.scroll(collection_name(kind), limit=500, offset=offset, with_payload=True, with_vectors=False)
        for p in res:
            ids.add(str(p.id))
            if p.payload:
                print("  PAYLOAD FOUND on", p.id, p.payload)
        if offset is None:
            return ids


with engine.connect() as c:
    one = lambda q: c.execute(text(q)).scalar()
    cand_ids = {r[0] for r in c.execute(text("select id from candidate"))}
    jd_ids = {r[0] for r in c.execute(text("select id from job_description where deleted_at is null"))}
    all_jd_ids = {r[0] for r in c.execute(text("select id from job_description"))}
    print("== rows vs vector points")
    for label, rows, kind in (("candidates", cand_ids, "candidate"), ("job descriptions", all_jd_ids, "job_description")):
        pts = points(kind)
        print(f"  {label}: {len(rows)} rows, {len(pts)} points, rows without a point: {len(rows - pts)}, points without a row: {len(pts - rows)}")
    print("== embeddings bookkeeping")
    print("  candidates never embedded:", one("select count(*) from candidate where embedded_at is null"))
    print("  embedding models in use:", [tuple(r) for r in c.execute(text("select embedding_model, count(*) from candidate group by 1"))],
          "| configured:", settings.EMBEDDING_MODEL_NAME)
    print("== Qdrant collections")
    for kind in ("candidate", "job_description"):
        info = client.get_collection(collection_name(kind))
        v = info.config.params.vectors
        print(f"  {collection_name(kind)}: status={info.status} points={info.points_count} indexed_vectors={info.indexed_vectors_count} vectors={ {k: (x.size, str(x.distance).split('.')[-1], x.on_disk) for k, x in v.items()} } hnsw_m={info.config.hnsw_config.m}")
    print("== integrity")
    for label, q in (
        ("candidates without a search row", "select count(*) from candidate c where not exists (select 1 from candidate_search s where s.candidate_id=c.id)"),
        ("search rows without full-text vectors", "select count(*) from candidate_search where literal_tsv is null or extra_tsv is null or location_tsv is null or nationality_tsv is null"),
        ("candidates without a stored file path", "select count(*) from candidate where file_path is null"),
        ("candidates with more than 20 skills / 10 responsibilities", "select count(*) from candidate where cardinality(skills)>20 or cardinality(responsibilities)>10"),
        ("candidates with no skills", "select count(*) from candidate where cardinality(skills)=0"),
        ("duplicate content hashes", "select count(*) from (select content_sha256 from candidate group by 1 having count(*)>1) d"),
        ("duplicate e-mails", "select count(*) from (select lower(email) from candidate where email is not null group by 1 having count(*)>1) d"),
        ("applications of one person to the same posting", "select count(*) from (select job_posting_id, candidate_id from job_application group by 1,2 having count(*)>1) d"),
        ("postings pointing at a missing description", "select count(*) from job_posting p where job_description_id is not null and not exists (select 1 from job_description j where j.id=p.job_description_id)"),
        ("tracker rows without a team", "select count(*) from tracker_job_opening where team is null"),
    ):
        print(f"  {label}: {one(q)}")
    print("== search storage (PostgreSQL keeps the search text only as full-text vectors; the plain copies must be empty)")
    print("  rows still holding plain text/literal:", one("select count(*) from candidate_search where text <> '' or literal <> ''"))
    print("  candidate_search total size vs the CV text it indexes:",
          tuple(c.execute(text("select pg_size_pretty(pg_total_relation_size('candidate_search')), pg_size_pretty(coalesce(sum(length(raw_text)), 0)::bigint) from candidate")).one()))
    print("== table sizes")
    for r in c.execute(text("select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 8")):
        print("  ", tuple(r))
    print("== indexes never used since the stats were reset (idx_scan = 0), excluding keys")
    for r in c.execute(text("select relname, indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) from pg_stat_user_indexes join pg_index using (indexrelid) where idx_scan = 0 and not indisunique and not indisprimary order by pg_relation_size(indexrelid) desc limit 12")):
        print("  ", tuple(r))
