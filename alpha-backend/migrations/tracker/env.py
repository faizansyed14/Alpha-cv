"""Alembic environment for the TRACKER database (job openings, candidates,
applications, follow-ups, manager settings).

URL comes from TRACKER_DB_URL via app settings — works against local
Postgres or AWS RDS without any code change.
"""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.models.tracker.base import tracker_metadata
import app.models.tracker.models  # noqa: F401  (registers tracker tables)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

if not settings.TRACKER_DB_URL:
    raise RuntimeError("TRACKER_DB_URL must be set to run tracker migrations")

config.set_main_option("sqlalchemy.url", settings.TRACKER_DB_URL)
target_metadata = tracker_metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.TRACKER_DB_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
