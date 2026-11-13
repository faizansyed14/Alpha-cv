# Database operations

What the database guarantees on its own, and what to watch as the CV count grows.

## What the database enforces (not just the app)

| Rule | How |
|---|---|
| A user's `role`, `otp_mode` and `location` are values the app knows; the EVP and the admin have no location | `CHECK` constraints `ck_user_*` (migration 0030). The lists live in `app/security/rbac_rules.py`; a test fails if the migration's copy drifts. |
| A requirement and a selection have a known status and location | `CHECK` constraints on `requirement` and `selection` |
| One selection row per requirement, even when two people close it at the same instant | unique `selection.requirement_id` plus `INSERT ... ON CONFLICT DO NOTHING` (`app/services/selections.py`) |
| Two people editing the same requirement take turns | `SELECT ... FOR UPDATE` on the row for update and delete (`_get_visible(..., lock=True)`) |
| Every timestamp is UTC | each PostgreSQL connection runs `SET TIME ZONE 'UTC'` (`app/db/database.py: pin_utc`, also for migrations), and the app logs an error at startup if a connection is not in UTC. Columns are `timestamp without time zone` holding UTC; the API sends them with a `Z`, so every browser shows its own local time. |

Migration 0030 refuses to run while an account holds a value the app does not allow, and prints which accounts. Fix those rows, then run it again.

## Watching growth

`GET /api/admin/database-health` (admin only) returns, for PostgreSQL: the database size, every table with heap, index and dead-row numbers, the largest indexes and `search_bytes_per_cv`, plus `warnings`.
The background worker runs the same check every `DB_HEALTH_INTERVAL_SECONDS` (6 hours; 0 turns it off) and logs a `Database storage warning` line for each problem. Alert on that text.

| Setting | Default | Warns when |
|---|---|---|
| `DB_DEAD_ROW_WARN_RATIO` | 0.2 | a table has at least 10,000 dead rows and more than this share of its rows are dead: vacuum is behind |
| `DB_SEARCH_BYTES_PER_CV_WARN` | 200000 | the CV search index costs more than this per CV (checked from 1,000 CVs) |
| `DB_SIZE_WARN_GB` | 0 (off) | the database is bigger than this |

## Routine care

* **Autovacuum** is tuned for the search tables (migration 0030): `candidate_search` is vacuumed after 2% dead rows, `candidate` after 5% (the PostgreSQL default is 20%). Nothing to run by hand in normal use.
* **When the warning "vacuum is behind" appears**: look for a long-open transaction (`select pid, now() - xact_start from pg_stat_activity where state <> 'idle' order by 2 desc`), end it, then `VACUUM (ANALYZE) candidate_search;`.
* **When the index costs too much per CV**: `VACUUM (ANALYZE) candidate_search;` and, if it stays high, rebuild without blocking searches: `REINDEX INDEX CONCURRENTLY ix_candidate_search_literal_fts;` (and `..._extra_fts`).
* **lz4 compression** applies to rows written after migration 0030 (when the server has lz4). Older rows keep their old compression until rewritten; that is optional and not needed for correctness.
* **Disk**: size the database volume for roughly (current size) x 2 while a `REINDEX` or `VACUUM FULL` runs; prefer `REINDEX ... CONCURRENTLY`, which needs only the size of one index.
