"""Storage health of the PostgreSQL database: how big each table and index is, how many dead rows wait for vacuum, and warnings when something
grows the wrong way. The CV search index (the ``candidate_search`` table) grows with every CV, so this is what tells you early, with numbers,
that vacuum is behind or that the index costs more per CV than it should, instead of finding out when the disk is full.

Read-only, PostgreSQL only (``supported`` is false elsewhere). Used by the admin API (GET /api/admin/database-health) and by the background worker,
which logs the warnings every DB_HEALTH_INTERVAL_SECONDS.
"""
from __future__ import annotations

from typing import Any, Dict, List

from sqlalchemy import text

from app.config.settings import settings

TABLES_SQL = text("""
    SELECT c.relname AS name,
           pg_table_size(c.oid) AS table_bytes,
           pg_indexes_size(c.oid) AS index_bytes,
           pg_total_relation_size(c.oid) AS total_bytes,
           COALESCE(s.n_live_tup, 0) AS live_rows,
           COALESCE(s.n_dead_tup, 0) AS dead_rows,
           s.last_autovacuum, s.last_vacuum, s.last_autoanalyze
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
""")
INDEXES_SQL = text("""
    SELECT s.relname AS table_name, s.indexrelname AS name, pg_relation_size(s.indexrelid) AS bytes, s.idx_scan AS scans
    FROM pg_stat_user_indexes s
    ORDER BY pg_relation_size(s.indexrelid) DESC
    LIMIT 12
""")


def _iso(value) -> Any:
    return value.isoformat() if value is not None else None


def storage_report(engine) -> Dict[str, Any]:
    """The sizes, the dead-row ratios and the warnings. Cheap: only catalogue and statistics views are read."""
    if engine.dialect.name != "postgresql":
        return {"supported": False, "warnings": []}
    with engine.connect() as conn:
        database_bytes = int(conn.execute(text("SELECT pg_database_size(current_database())")).scalar() or 0)
        tables = [dict(r._mapping) for r in conn.execute(TABLES_SQL)]
        indexes = [dict(r._mapping) for r in conn.execute(INDEXES_SQL)]

    rows: List[Dict[str, Any]] = []
    for t in tables:
        live, dead = int(t["live_rows"]), int(t["dead_rows"])
        rows.append({
            "name": t["name"], "total_bytes": int(t["total_bytes"]), "table_bytes": int(t["table_bytes"]), "index_bytes": int(t["index_bytes"]),
            "live_rows": live, "dead_rows": dead, "dead_ratio": round(dead / (live + dead), 4) if (live + dead) else 0.0,
            "last_autovacuum": _iso(t["last_autovacuum"]), "last_vacuum": _iso(t["last_vacuum"]), "last_autoanalyze": _iso(t["last_autoanalyze"]),
        })
    by_name = {r["name"]: r for r in rows}
    cvs = by_name.get("candidate", {}).get("live_rows", 0)
    search = by_name.get("candidate_search", {})
    per_cv = int(search.get("total_bytes", 0) / cvs) if cvs else None

    warnings: List[str] = []
    for r in rows:
        if r["dead_rows"] >= 10000 and r["dead_ratio"] > settings.DB_DEAD_ROW_WARN_RATIO:
            warnings.append(f"{r['name']}: {r['dead_ratio']:.0%} of its rows are dead ({r['dead_rows']:,}). Vacuum is behind: check that autovacuum is running and not blocked by a long transaction.")
    if per_cv is not None and cvs >= 1000 and per_cv > settings.DB_SEARCH_BYTES_PER_CV_WARN:
        warnings.append(f"The CV search index takes {per_cv:,} bytes per CV (the limit is {settings.DB_SEARCH_BYTES_PER_CV_WARN:,}): it grows faster than the CVs do. "
                        "Run VACUUM (ANALYZE) candidate_search and, if it stays high, REINDEX INDEX CONCURRENTLY on its full-text indexes.")
    if settings.DB_SIZE_WARN_GB and database_bytes > settings.DB_SIZE_WARN_GB * 1024 ** 3:
        warnings.append(f"The database is {database_bytes / 1024 ** 3:.1f} GB, over the {settings.DB_SIZE_WARN_GB:g} GB limit set in DB_SIZE_WARN_GB.")
    for i in indexes:
        if i["scans"] == 0 and i["bytes"] > 512 * 1024 ** 2:
            warnings.append(f"Index {i['name']} on {i['table_name']} is {i['bytes'] / 1024 ** 2:,.0f} MB and has never been used since statistics were reset.")

    return {
        "supported": True,
        "database_bytes": database_bytes,
        "candidates": cvs,
        "search_bytes_per_cv": per_cv,
        "tables": rows,
        "largest_indexes": [{"table": i["table_name"], "name": i["name"], "bytes": int(i["bytes"]), "scans": int(i["scans"] or 0)} for i in indexes],
        "warnings": warnings,
    }
