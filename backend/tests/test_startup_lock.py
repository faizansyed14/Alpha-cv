"""Schema setup is serialised across processes with a Postgres advisory lock (and never blocks startup itself)."""

from unittest.mock import MagicMock

import pytest

from app.db import startup_lock


def _postgres(monkeypatch, engine):
    monkeypatch.setattr(startup_lock.settings, "DATABASE_URL", "postgresql+psycopg2://u:p@db/auth_db")
    monkeypatch.setattr("app.db.database.engine", engine)


def test_sqlite_needs_no_lock(monkeypatch):
    monkeypatch.setattr(startup_lock.settings, "DATABASE_URL", "sqlite:///x.db")
    with startup_lock.schema_init_lock():
        pass


def test_lock_is_taken_before_the_block_and_released_after_it(monkeypatch):
    calls = []
    conn = MagicMock()
    conn.execution_options.return_value = conn
    conn.execute.side_effect = lambda stmt, params=None: calls.append(str(stmt))
    engine = MagicMock()
    engine.connect.return_value = conn
    _postgres(monkeypatch, engine)

    with startup_lock.schema_init_lock():
        calls.append("BLOCK")
    sql = " | ".join(calls)
    assert sql.index("pg_advisory_lock") < sql.index("BLOCK") < sql.index("pg_advisory_unlock")
    conn.close.assert_called_once()


def test_lock_is_released_even_when_the_block_fails(monkeypatch):
    conn = MagicMock()
    conn.execution_options.return_value = conn
    engine = MagicMock()
    engine.connect.return_value = conn
    _postgres(monkeypatch, engine)

    with pytest.raises(RuntimeError):
        with startup_lock.schema_init_lock():
            raise RuntimeError("migration failed")
    assert any("pg_advisory_unlock" in str(c.args[0]) for c in conn.execute.call_args_list)


def test_an_unreachable_lock_does_not_block_startup(monkeypatch):
    engine = MagicMock()
    engine.connect.side_effect = RuntimeError("db down")
    _postgres(monkeypatch, engine)
    ran = []
    with startup_lock.schema_init_lock():
        ran.append(True)
    assert ran == [True]
