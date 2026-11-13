"""tracker: job location and salary columns, the canceled status, and a location that is no longer typed

* requirement.job_location and requirement.salary: new optional columns.
* status may now also be 'canceled'.
* requirement.location (Dubai / Abu Dhabi, which team may see it) is no longer chosen on the form: it is the location of the person who
  adds the requirement, or, for the EVP and the admin, of the recruiter it is assigned to. A requirement they add before assigning anyone
  has none yet, so the column may be empty.

Revision ID: 0023_tracker_columns
Revises: 0022_remove_saved_cvs
Create Date: 2026-11-12 11:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0023_tracker_columns'
down_revision: Union[str, None] = '0022_remove_saved_cvs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_STATUSES = ("open", "submitted", "hold", "closed")
NEW_STATUSES = OLD_STATUSES + ("canceled",)


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.add_column("requirement", sa.Column("job_location", sa.String(length=160), nullable=True))
    op.add_column("requirement", sa.Column("salary", sa.String(length=64), nullable=True))
    with op.batch_alter_table("requirement") as batch:
        batch.alter_column("location", existing_type=sa.String(length=32), nullable=True)
        batch.drop_constraint("ck_requirement_status", type_="check")
        batch.create_check_constraint("ck_requirement_status", _in("status", NEW_STATUSES))


def downgrade() -> None:
    # a canceled requirement goes back to hold (it is not a closure); one with no location takes its recruiter's, or Dubai
    op.execute("UPDATE requirement SET status = 'hold' WHERE status = 'canceled'")
    op.execute("UPDATE requirement SET location = COALESCE((SELECT u.location FROM \"user\" u WHERE u.id = requirement.recruiter_id), 'Dubai') "
               "WHERE location IS NULL")
    with op.batch_alter_table("requirement") as batch:
        batch.drop_constraint("ck_requirement_status", type_="check")
        batch.create_check_constraint("ck_requirement_status", _in("status", OLD_STATUSES))
        batch.alter_column("location", existing_type=sa.String(length=32), nullable=False)
    op.drop_column("requirement", "salary")
    op.drop_column("requirement", "job_location")
