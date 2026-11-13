"""requirements tracker: a location on the user, the requirement table and its history

Revision ID: 0020_requirement_tracker
Revises: 0019_remove_tracker
Create Date: 2026-11-11 15:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0020_requirement_tracker'
down_revision: Union[str, None] = '0019_remove_tracker'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATUSES = ("open", "submitted", "hold", "closed")
LOCATIONS = ("Dubai", "Abu Dhabi")


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "location" not in {c["name"] for c in insp.get_columns("user")}:
        op.add_column("user", sa.Column("location", sa.String(), nullable=True))

    op.create_table(
        "requirement",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("location", sa.String(length=32), nullable=False),
        sa.Column("requirement_date", sa.Date(), nullable=False),
        sa.Column("position", sa.String(length=160), nullable=False),
        sa.Column("client", sa.String(length=160), nullable=False),
        sa.Column("jd_id", sa.String(length=36), nullable=True),
        sa.Column("jd_filename", sa.String(length=255), nullable=True),
        sa.Column("sales_comments", sa.Text(), nullable=True),
        sa.Column("rm_comments", sa.Text(), nullable=True),
        sa.Column("recruiter_comments", sa.Text(), nullable=True),
        sa.Column("job_id", sa.String(length=36), nullable=True),
        sa.Column("cv_submission_date", sa.Date(), nullable=True),
        sa.Column("recruiter_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(_in("status", STATUSES), name="ck_requirement_status"),
        sa.CheckConstraint(_in("location", LOCATIONS), name="ck_requirement_location"),
    )
    op.create_index("ix_requirement_location_status", "requirement", ["location", "status"])
    op.create_index("ix_requirement_recruiter", "requirement", ["recruiter_id", "status"])
    op.create_index("ix_requirement_date", "requirement", ["requirement_date"])

    op.create_table(
        "requirement_event",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("requirement_id", sa.String(length=36), sa.ForeignKey("requirement.id", ondelete="CASCADE"), nullable=False),
        sa.Column("at", sa.DateTime(), nullable=False),
        sa.Column("actor", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("field", sa.String(length=32), nullable=True),
        sa.Column("old_value", sa.String(length=500), nullable=True),
        sa.Column("new_value", sa.String(length=500), nullable=True),
    )
    op.create_index("ix_requirement_event_req_at", "requirement_event", ["requirement_id", "at"])


def downgrade() -> None:
    op.drop_index("ix_requirement_event_req_at", table_name="requirement_event")
    op.drop_table("requirement_event")
    for name in ("ix_requirement_date", "ix_requirement_recruiter", "ix_requirement_location_status"):
        op.drop_index(name, table_name="requirement")
    op.drop_table("requirement")
    op.drop_column("user", "location")
