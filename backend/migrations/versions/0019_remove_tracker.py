"""remove the candidate tracker: its tables, and the team a user belonged to (only the tracker used it)

Everything in the tracker tables is DELETED by this migration (follow-ups, job openings, tracker candidates and applications,
dropdown options and the follow-up e-mail recipients). Take a backup first (scripts/backup.sh): nothing here can be undone.

Also: roles are now identical except for admin. A user whose stored role is not one the application knows becomes a recruiter ("user").

Revision ID: 0019_remove_tracker
Revises: 0018_no_fixed_otp_mode
Create Date: 2026-11-11 09:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0019_remove_tracker'
down_revision: Union[str, None] = '0018_no_fixed_otp_mode'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# children first: an application points at a candidate and a job opening
TRACKER_TABLES = ("tracker_application", "tracker_follow_up", "tracker_candidate", "tracker_job_opening", "tracker_option")
KNOWN_ROLES = ("admin", "user", "manager", "evp", "account_manager")


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())
    # the per-team copies (tracker_*_ad) were merged into the main tables by 0012; a database that skipped that step may still have them
    for name in TRACKER_TABLES + tuple(f"{t}_ad" for t in TRACKER_TABLES):
        if name in existing:
            op.drop_table(name)

    if "user" in existing:
        columns = {c["name"] for c in insp.get_columns("user")}
        if "team_location" in columns:
            for index in insp.get_indexes("user"):
                if "team_location" in (index.get("column_names") or []):
                    op.drop_index(index["name"], table_name="user")
            with op.batch_alter_table("user") as batch:
                batch.drop_column("team_location")
        marks = ", ".join(f":r{i}" for i in range(len(KNOWN_ROLES)))
        bind.execute(sa.text(f'UPDATE "user" SET role = \'user\' WHERE role NOT IN ({marks})'),
                     {f"r{i}": r for i, r in enumerate(KNOWN_ROLES)})


def downgrade() -> None:
    # The tracker data cannot be brought back by a migration (restore a backup made before 0019). The column is restored empty so older code can start.
    with op.batch_alter_table("user") as batch:
        batch.add_column(sa.Column("team_location", sa.String(), nullable=True))
