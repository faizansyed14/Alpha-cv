"""tracker: a requirement may have several recruiters, each with their own CVs submitted

``requirement_recruiter`` links a requirement to every recruiter assigned to it (position 0 is the lead, still ``requirement.recruiter_id``,
who is credited when it is closed). The day CVs were submitted and how many belong to each recruiter, so they move from ``requirement`` to
the link: every requirement that had a recruiter gets one link row carrying those two values.

Revision ID: 0026_multi_recruiters
Revises: 0025_cvs_submitted
Create Date: 2026-11-12 18:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0026_multi_recruiters'
down_revision: Union[str, None] = '0025_cvs_submitted'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "requirement_recruiter",
        sa.Column("requirement_id", sa.String(length=36), sa.ForeignKey("requirement.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recruiter_id", sa.String(length=36), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("cvs_submitted_date", sa.Date(), nullable=True),
        sa.Column("cvs_submitted_count", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("requirement_id", "recruiter_id"),
        sa.CheckConstraint("cvs_submitted_count IS NULL OR cvs_submitted_count BETWEEN 0 AND 100000", name="ck_requirement_recruiter_cvs"),
    )
    op.create_index("ix_requirement_recruiter_user", "requirement_recruiter", ["recruiter_id"])
    op.execute("INSERT INTO requirement_recruiter (requirement_id, recruiter_id, position, cvs_submitted_date, cvs_submitted_count) "
               "SELECT id, recruiter_id, 0, cvs_submitted_date, cvs_submitted_count FROM requirement WHERE recruiter_id IS NOT NULL")
    op.drop_constraint("ck_requirement_cvs_submitted", "requirement", type_="check")
    op.drop_column("requirement", "cvs_submitted_count")
    op.drop_column("requirement", "cvs_submitted_date")


def downgrade() -> None:
    # only the lead recruiter and his CVs submitted survive going back: a requirement had one recruiter then
    op.add_column("requirement", sa.Column("cvs_submitted_date", sa.Date(), nullable=True))
    op.add_column("requirement", sa.Column("cvs_submitted_count", sa.Integer(), nullable=True))
    op.execute("UPDATE requirement SET "
               "cvs_submitted_date = (SELECT rr.cvs_submitted_date FROM requirement_recruiter rr WHERE rr.requirement_id = requirement.id AND rr.recruiter_id = requirement.recruiter_id), "
               "cvs_submitted_count = (SELECT rr.cvs_submitted_count FROM requirement_recruiter rr WHERE rr.requirement_id = requirement.id AND rr.recruiter_id = requirement.recruiter_id)")
    op.create_check_constraint("ck_requirement_cvs_submitted", "requirement", "cvs_submitted_count IS NULL OR cvs_submitted_count BETWEEN 0 AND 100000")
    op.drop_index("ix_requirement_recruiter_user", table_name="requirement_recruiter")
    op.drop_table("requirement_recruiter")
