"""Serialise first-run schema setup across processes.

The API starts several uvicorn workers and the background worker starts next to it, and each one creates / migrates the
same tables on startup. On a brand-new database two of them can try to create a table at the same moment, and Postgres
answers one with "duplicate key value violates unique constraint pg_type_typname_nsp_index", which kills that process's
startup. A Postgres advisory lock makes them take turns: the first does the work, the others then find it done.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator

from app.config.settings import settings

logger = logging.getLogger(__name__)

SCHEMA_LOCK_KEY = 7231002
WAIT_SECONDS = 120


@contextmanager
def schema_init_lock() -> Iterator[None]:
    """Hold the schema-setup lock for the block. A no-op for SQLite and when the lock cannot be taken."""
    if not settings.AUTH_DB_URL.startswith("postgres"):
        yield
        return

    from sqlalchemy import text

    from app.db.auth_db import engine

    conn = None
    try:
        conn = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
        conn.execute(text(f"SET lock_timeout = '{WAIT_SECONDS}s'"))
        conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": SCHEMA_LOCK_KEY})
    except Exception as exc:  # noqa: BLE001 - never block startup on the lock itself
        logger.warning(f"Schema lock unavailable ({exc}); continuing without it")
        if conn is not None:
            conn.close()
            conn = None
    try:
        yield
    finally:
        if conn is not None:
            try:
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": SCHEMA_LOCK_KEY})
            finally:
                conn.close()
