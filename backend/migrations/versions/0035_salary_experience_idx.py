"""Indexes for the expected-salary and years-of-experience filters

Nothing is changed, two indexes are added. They let a narrow range ("AED 30,000 - 35,000", "15+ years") go straight to the CVs in it
instead of reading the newest CVs until enough match, which matters once the table holds hundreds of thousands of CVs. Only CVs that
have the value are indexed (most CVs have no expected salary), so they are small.

Built in the migration's transaction (all or nothing). While each one is built, CVs can still be read and searched; saving a CV waits
for it, which on this table is a matter of milliseconds. (CREATE INDEX CONCURRENTLY is not used: it waits for every other open
statement on the database, including the other workers waiting at startup for the migration lock, so it could never finish.)

Revision ID: 0035_salary_experience_idx
Revises: 0034_notifications
Create Date: 2026-11-19 12:00:00
"""
from typing import Sequence, Union

from alembic import op


revision: str = '0035_salary_experience_idx'
down_revision: Union[str, None] = '0034_notifications'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEXES = (("ix_candidate_expected_salary", "expected_salary"), ("ix_candidate_years_experience", "years_of_experience"))


def upgrade() -> None:
    for name, column in INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON candidate ({column}) WHERE {column} IS NOT NULL")


def downgrade() -> None:
    for name, _ in INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
