"""The application's single relational database (PostgreSQL): users, the candidate tracker and email-intake tables.

The schema is owned by Alembic: one migration history in backend/migrations, applied with `alembic upgrade head`.
`init_database()` runs that at startup (under the schema lock, so several workers take turns) and seeds the admin
user. Nothing else creates or alters tables.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Generator

from sqlmodel import Session, SQLModel, create_engine, select

from app.config.settings import settings

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _looks_like_prod(url: str) -> bool:
    hints = [h.strip().lower() for h in (settings.TRACKER_PROD_URL_HINTS or "").split(",") if h.strip()]
    return any(h in url.lower() for h in hints)


def _assert_safe_database_url(url: str) -> None:
    env = (os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development").lower()
    if env == "production" or not url:
        return
    if _looks_like_prod(url) and not settings.ALLOW_PROD_DATA_ACCESS:
        raise RuntimeError(
            "Refusing to use a DATABASE_URL that matches TRACKER_PROD_URL_HINTS in non-production. "
            "Set ALLOW_PROD_DATA_ACCESS=true to override (not recommended)."
        )


_assert_safe_database_url(settings.DATABASE_URL)

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=({"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {"connect_timeout": 10}),
    pool_pre_ping=True,   # verify connections before using them
    pool_recycle=3600,
    echo=False,
)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def _alembic_config():
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.attributes["configure_logger"] = False   # keep the app's own logging
    return cfg


def run_migrations() -> None:
    """Bring the database to the latest schema. A database that predates Alembic (tables, no version row) is
    completed additively and then marked as current, so existing deployments need no manual step."""
    from alembic import command
    from sqlalchemy import inspect

    import app.models.agent  # noqa: F401  (registers the tables)
    import app.models.tracker.models  # noqa: F401
    import app.models.user  # noqa: F401

    cfg = _alembic_config()
    tables = set(inspect(engine).get_table_names())
    if "alembic_version" not in tables and "user" in tables:
        logger.info("Existing database without migration history: completing tables and marking it current")
        SQLModel.metadata.create_all(engine)
        command.stamp(cfg, "head")
    else:
        command.upgrade(cfg, "head")


def init_database() -> None:
    from app.models.user import User
    from app.security.auth import hash_password

    run_migrations()
    with Session(engine) as session:
        if settings.ENABLE_AUTH:
            admin = session.exec(select(User).where(User.username == settings.ADMIN_USERNAME)).first()
            if not admin:
                session.add(User(
                    username=settings.ADMIN_USERNAME,
                    password_hash=hash_password(settings.ADMIN_PASSWORD),
                    role="admin",
                    is_active=True,
                ))
                session.commit()
                logger.info("Seeded initial admin '%s'", settings.ADMIN_USERNAME)
            # The admin password is NOT reset on startup: credentials are seeded once from the environment.
