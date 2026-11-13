"""Database-level guarantees and storage settings

* ``user``: the database itself refuses a role, MFA mode or location the app does not know, and a location on a role that sees every location.
  The migration stops with the list of offending accounts instead of changing anyone silently: fix those rows, then run it again.
* PostgreSQL storage: the search tables are updated whenever a CV is (re)indexed, so they get their own autovacuum thresholds (dead rows are
  cleaned long before they become bloat), and new rows of the big text/tsvector columns are compressed with lz4 where the server has it.

Revision ID: 0030_integrity_and_storage
Revises: 0029_selections_joining
Create Date: 2026-11-13 09:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0030_integrity_and_storage'
down_revision: Union[str, None] = '0029_selections_joining'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ROLES = ("admin", "user", "manager", "evp", "account_manager")
OTP_MODES = ("real", "captcha")
LOCATIONS = ("Dubai", "Abu Dhabi")
LOCATION_ROLES = ("user", "manager", "account_manager")


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    bind = op.get_bind()
    bad = bind.execute(sa.text(
        'SELECT username, role, otp_mode, location FROM "user" WHERE NOT (' + _in("role", ROLES) + ") OR NOT (" + _in("otp_mode", OTP_MODES)
        + ") OR (location IS NOT NULL AND NOT (" + _in("location", LOCATIONS) + ")) OR (location IS NOT NULL AND NOT (" + _in("role", LOCATION_ROLES) + "))"
    )).all()
    if bad:
        listing = "; ".join(f"{r[0]} (role={r[1]!r}, otp_mode={r[2]!r}, location={r[3]!r})" for r in bad[:20])
        raise RuntimeError("These accounts hold a value the application does not allow, so the database cannot be made to refuse it yet. "
                           f"Correct them (role: {', '.join(ROLES)}; otp_mode: {', '.join(OTP_MODES)}; location: {', '.join(LOCATIONS)} or empty, "
                           f"and empty for the EVP and the admin), then run the migration again: {listing}")
    op.create_check_constraint("ck_user_role", "user", _in("role", ROLES))
    op.create_check_constraint("ck_user_otp_mode", "user", _in("otp_mode", OTP_MODES))
    op.create_check_constraint("ck_user_location", "user", "location IS NULL OR " + _in("location", LOCATIONS))
    op.create_check_constraint("ck_user_location_roles", "user", "location IS NULL OR " + _in("role", LOCATION_ROLES))

    if bind.dialect.name != "postgresql":
        return
    # dead rows are cleaned after 2% (the default is 20%), and the planner's statistics follow just as closely
    op.execute("ALTER TABLE candidate_search SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 1000)")
    op.execute("ALTER TABLE candidate SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05)")
    # lz4 compresses (and decompresses) faster than the default; it needs PostgreSQL 14+ built with lz4, so a server without it is left as it is
    op.execute("""
        DO $$ BEGIN
            ALTER TABLE candidate_search ALTER COLUMN literal_tsv SET COMPRESSION lz4;
            ALTER TABLE candidate_search ALTER COLUMN extra_tsv SET COMPRESSION lz4;
            ALTER TABLE candidate ALTER COLUMN raw_text SET COMPRESSION lz4;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'lz4 compression is not available on this server (%): the default is kept', SQLERRM;
        END $$;
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE candidate RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor)")
        op.execute("ALTER TABLE candidate_search RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor, autovacuum_vacuum_cost_limit)")
    for name in ("ck_user_location_roles", "ck_user_location", "ck_user_otp_mode", "ck_user_role"):
        op.drop_constraint(name, "user", type_="check")
