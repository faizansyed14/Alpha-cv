"""The few queries that look inside an array column. PostgreSQL has real arrays (text[]); the SQLite used by the tests keeps the same
columns as JSON lists, so each query is written once per dialect and both are tested (see tests/test_store.py)."""
from __future__ import annotations

from typing import Any, Iterable, List

from sqlalchemy import func, select, tablesample, text


def _postgres(engine: Any) -> bool:
    return engine.dialect.name == "postgresql"


def contains_any(engine: Any, column: Any, values: Iterable[str]):
    """True when the array in ``column`` holds at least one of ``values`` (exact match)."""
    wanted: List[str] = list(values)
    if _postgres(engine):
        return column.overlap(wanted)
    item = func.json_each(column).table_valued("value")
    return select(1).select_from(item).where(item.c.value.in_(wanted)).exists()


def length(engine: Any, column: Any):
    """How many items the array in ``column`` holds."""
    return func.coalesce(func.cardinality(column) if _postgres(engine) else func.json_array_length(column), 0)


BIG_TABLE_ROWS = 200_000      # above this many rows a facet reads a sample of about SAMPLE_ROWS rows instead of all of them
SAMPLE_ROWS = 100_000


def sample_percent(engine: Any, session: Any, table: str):
    """None when the table is small (read every row); otherwise the percentage of the table's pages to sample (PostgreSQL only)."""
    if not _postgres(engine):
        return None
    rows = int(session.execute(text("SELECT COALESCE(reltuples, 0)::bigint FROM pg_class WHERE relname = :t"), {"t": table}).scalar() or 0)
    return None if rows <= BIG_TABLE_ROWS else max(0.1, min(100.0, 100.0 * SAMPLE_ROWS / rows))


def facet(engine: Any, model: Any, column: Any, limit: int, percent: Any = None):
    """SELECT value, number of rows holding it, over every item of every array in ``column``; most common first.
    ``percent`` (PostgreSQL) reads only that share of the table's pages, for a table too big to scan on every request."""
    if _postgres(engine):
        if percent:
            column = getattr(tablesample(model, func.system(percent)).c, column.key)
        sub = select(func.unnest(column).label("value")).subquery()
        return (select(sub.c.value, func.count().label("n")).where(sub.c.value.is_not(None), sub.c.value != "")
                .group_by(sub.c.value).order_by(func.count().desc(), sub.c.value).limit(limit))
    item = func.json_each(column).table_valued("value")
    return (select(item.c.value, func.count().label("n")).select_from(model, item).where(item.c.value != "")
            .group_by(item.c.value).order_by(func.count().desc(), item.c.value).limit(limit))
