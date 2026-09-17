"""Alembic environment for the AUTH database (users).

URL comes from AUTH_DB_URL via app settings — works against local Postgres,
sqlite, or AWS RDS without any code change.
"""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from sqlmodel import SQLModel
import app.models.user  # noqa: F401  (registers the User table)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.AUTH_DB_URL)
target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.AUTH_DB_URL,
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
