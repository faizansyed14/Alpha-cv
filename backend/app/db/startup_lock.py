"""Serialise first-run schema setup across processes.

The API starts several uvicorn workers and the background worker starts next to it, and each one creates / migrates the
same tables on startup. On a brand-new database two of them can try to create a table at the same moment, and Postgres
answers one with "duplicate key value violates unique constraint pg_type_typname_nsp_index", which kills that process's
startup. A Postgres advisory lock makes them take turns: the first does the work, the others then find it done.

The others wait by TRYING the lock every half second, not by sitting in a blocking ``pg_advisory_lock`` call: a statement
that is waiting holds a snapshot, and some schema work (an index built CONCURRENTLY, for one) waits for every such snapshot
to end, so a blocked waiter and the migration would wait for each other. If the lock is still taken after WAIT_SECONDS, the
process stops (and is restarted by Docker) rather than migrating at the same time as another one.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Iterator

from app.config.settings import settings

logger = logging.getLogger(__name__)

SCHEMA_LOCK_KEY = 7231002
WAIT_SECONDS = 600            # a long migration on a big table may take minutes; the waiting processes cost nothing meanwhile
POLL_SECONDS = 0.5


class SchemaLockTimeout(RuntimeError):
    """Another process has held the schema lock for longer than WAIT_SECONDS."""


@contextmanager
def schema_init_lock() -> Iterator[None]:
    """Hold the schema-setup lock for the block. A no-op for SQLite and when the lock cannot be used at all (no permission,
    an old PostgreSQL); a lock that is merely taken is waited for."""
    if not settings.DATABASE_URL.startswith("postgres"):
        yield
        return

    from sqlalchemy import text

    from app.db.database import engine

    conn = None
    try:
        conn = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    except Exception as exc:  # noqa: BLE001 - never block startup on the lock itself
        logger.warning(f"Schema lock unavailable ({exc}); continuing without it")
        conn = None

    if conn is not None:
        deadline = time.monotonic() + WAIT_SECONDS
        waited = False
        try:
            while True:
                try:
                    got = bool(conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": SCHEMA_LOCK_KEY}).scalar())
                except Exception as exc:  # noqa: BLE001 - the lock function itself fails: go on as before, without it
                    logger.warning(f"Schema lock unavailable ({exc}); continuing without it")
                    conn.close()
                    conn = None
                    break
                if got:
                    if waited:
                        logger.info("Schema lock taken: another process finished its schema setup")
                    break
                if not waited:
                    logger.info("Another process is setting up the schema; waiting for it")
                    waited = True
                if time.monotonic() >= deadline:
                    raise SchemaLockTimeout(f"The schema lock was still held after {WAIT_SECONDS}s; stopping instead of migrating alongside it")
                time.sleep(POLL_SECONDS)
        except SchemaLockTimeout:
            conn.close()
            raise

    try:
        yield
    finally:
        if conn is not None:
            try:
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": SCHEMA_LOCK_KEY})
            finally:
                conn.close()
