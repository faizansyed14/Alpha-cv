"""Alembic environment for the application's single database.

The URL comes from DATABASE_URL (app settings), so it works against local Postgres or AWS RDS unchanged. Every model
(users, AI agents, bug reports, candidates) is registered on one metadata, so autogenerate sees the whole schema.
"""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, event, pool
from sqlmodel import SQLModel

from app.config.settings import settings
import app.models.agent  # noqa: F401  (registers tables)
import app.models.bug_report  # noqa: F401
import app.models.requirement  # noqa: F401  (the tracker: without these, autogenerate would propose dropping its tables)
import app.models.selection  # noqa: F401
import app.models.talent  # noqa: F401
import app.models.user  # noqa: F401

config = context.config
# The CLI configures logging from alembic.ini; when the app runs migrations itself it keeps its own logging.
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))
target_metadata = SQLModel.metadata


def include_object(obj, name, type_, reflected, compare_to):
    """The trigram indexes on the JD library (created by hand in a migration, they are expressions the models do not declare) are not drift."""
    return not (type_ == "index" and reflected and (name or "").endswith("_trgm"))


def run_migrations_offline() -> None:
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        include_object=include_object,
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
    if connectable.dialect.name == "postgresql":
        from app.db.database import pin_utc

        event.listen(connectable, "connect", pin_utc)          # migrations run in UTC too
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
