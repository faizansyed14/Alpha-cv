"""Selections and joining: the date the candidate joined

One empty column is added to ``selection``; no row is changed. Adding a nullable column without a default only changes the table's
description, so it is instant whatever the size of the table.

Revision ID: 0036_selection_joined_date
Revises: 0035_salary_experience_idx
Create Date: 2026-11-19 15:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '0036_selection_joined_date'
down_revision: Union[str, None] = '0035_salary_experience_idx'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("selection", sa.Column("joined_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("selection", "joined_date")
