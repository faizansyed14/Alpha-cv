"""bug reports no longer record the page they were sent from

Revision ID: 0015_bug_report_drop_page_url
Revises: 0014_bug_report
Create Date: 2026-11-09 19:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0015_bug_report_drop_page_url'
down_revision: Union[str, None] = '0014_bug_report'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("bug_report") as batch:
        batch.drop_column("page_url")


def downgrade() -> None:
    with op.batch_alter_table("bug_report") as batch:
        batch.add_column(sa.Column("page_url", sa.String(length=512), nullable=True))
