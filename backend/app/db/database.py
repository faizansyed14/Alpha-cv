"""The application's single relational database (PostgreSQL): users, the AI agents' history and bug reports.

The schema is owned by Alembic: one migration history in backend/migrations, applied with `alembic upgrade head`.
`init_database()` runs that at startup (under the schema lock, so several workers take turns) and seeds the admin
user. Nothing else creates or alters tables.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Generator

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine, select

from app.config.settings import settings

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _looks_like_prod(url: str) -> bool:
    hints = [h.strip().lower() for h in (settings.PROD_DB_URL_HINTS or "").split(",") if h.strip()]
    return any(h in url.lower() for h in hints)


def _assert_safe_database_url(url: str) -> None:
    env = (os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development").lower()
    if env == "production" or not url:
        return
    if _looks_like_prod(url) and not settings.ALLOW_PROD_DATA_ACCESS:
        raise RuntimeError(
            "Refusing to use a DATABASE_URL that matches PROD_DB_URL_HINTS in non-production. "
            "Set ALLOW_PROD_DATA_ACCESS=true to override (not recommended)."
        )


_assert_safe_database_url(settings.DATABASE_URL)

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=({"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {"connect_timeout": 10}),
    pool_pre_ping=True,   # verify connections before using them
    pool_recycle=3600,
    echo=False,
    **({} if settings.DATABASE_URL.startswith("sqlite") else
       {"pool_size": settings.DB_POOL_SIZE, "max_overflow": settings.DB_MAX_OVERFLOW, "pool_timeout": settings.DB_POOL_TIMEOUT_SECONDS}),
)


def pin_utc(dbapi_connection, _record=None) -> None:
    """Every PostgreSQL connection runs in UTC. The app writes UTC (naive ``datetime.utcnow()`` values and the clock's ``now()`` defaults), so the
    session time zone must be UTC too, whatever the server, the managed database or a pooler is set to: otherwise ``now()`` would store local
    time next to UTC values. Done on each new connection, not as a startup option, because poolers such as PgBouncer drop startup options."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("SET TIME ZONE 'UTC'")
    finally:
        cursor.close()
    dbapi_connection.commit()


if engine.dialect.name == "postgresql":
    event.listen(engine, "connect", pin_utc)


def check_utc() -> None:
    """Startup check of the same promise: log loudly when a connection is not in UTC (a pooler in transaction mode can undo a SET)."""
    if engine.dialect.name != "postgresql":
        return
    from sqlalchemy import text

    with engine.connect() as conn:
        zone = conn.execute(text("SHOW TimeZone")).scalar()
    if str(zone).upper() not in ("UTC", "ETC/UTC"):
        logger.error("The database session time zone is %s, not UTC: timestamps written by the database defaults would not match the application's UTC values.", zone)


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
    import app.models.bug_report  # noqa: F401
    import app.models.requirement  # noqa: F401
    import app.models.selection  # noqa: F401
    import app.models.user  # noqa: F401

    cfg = _alembic_config()
    tables = set(inspect(engine).get_table_names())
    if "alembic_version" not in tables and "user" in tables:
        logger.info("Existing database without migration history: completing tables and marking it current")
        SQLModel.metadata.create_all(engine)
        command.stamp(cfg, "head")
    else:
        command.upgrade(cfg, "head")


def sync_admin_from_env(session: Session) -> None:
    """The admin's email and password come from the environment (.env: ADMIN_EMAIL, ADMIN_PASSWORD) and nowhere else: they are applied at
    every start, so changing them in .env and restarting is the only way to change them (the Users page and the API refuse). The account
    is also kept an active admin. An address another account already uses is never taken. Nothing secret is written to the log."""
    from sqlalchemy import func

    from app.models.user import User
    from app.security.auth import hash_password, verify_password

    admin = session.exec(select(User).where(User.username == settings.ADMIN_USERNAME)).first()
    if admin is None:
        return
    changed = []
    if settings.ADMIN_PASSWORD and not verify_password(settings.ADMIN_PASSWORD, admin.password_hash):
        admin.password_hash = hash_password(settings.ADMIN_PASSWORD)
        changed.append("password")
    wanted = settings.ADMIN_EMAIL.strip().lower()
    if not wanted:
        if not admin.email:
            logger.error("The admin account has no email and ADMIN_EMAIL is not set: nobody can sign in as admin. Set ADMIN_EMAIL in the .env file.")
    elif (admin.email or "").lower() != wanted:
        if session.exec(select(User).where(func.lower(User.email) == wanted, User.id != admin.id)).first() is not None:
            logger.error("ADMIN_EMAIL is used by another account, so the admin keeps its current email. Change that account's email first.")
        else:
            admin.email = wanted
            changed.append("email")
    if admin.role != "admin" or not admin.is_active:
        admin.role, admin.is_active = "admin", True
        changed.append("role/active")
    if changed:
        session.add(admin)
        session.commit()
        logger.info("The admin account was brought in line with the .env file (%s)", ", ".join(changed))


def init_database() -> None:
    from app.models.user import User
    from app.security.auth import hash_password

    run_migrations()
    check_utc()
    with Session(engine) as session:
        if settings.ENABLE_AUTH:
            admin = session.exec(select(User).where(User.username == settings.ADMIN_USERNAME)).first()
            if not admin:
                session.add(User(
                    username=settings.ADMIN_USERNAME,
                    password_hash=hash_password(settings.ADMIN_PASSWORD),
                    email=settings.ADMIN_EMAIL.strip().lower() or None,
                    otp_mode="captcha",        # the admin starts on the CAPTCHA (needs no mailbox); it can be changed on the Users page
                    role="admin",
                    is_active=True,
                ))
                session.commit()
                logger.info("Seeded initial admin '%s'", settings.ADMIN_USERNAME)
            sync_admin_from_env(session)
