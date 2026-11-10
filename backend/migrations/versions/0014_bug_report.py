"""bug reports: one table for what users report from the "Report a bug" page

Revision ID: 0014_bug_report
Revises: 0013_lean_search_storage
Create Date: 2026-11-09 18:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0014_bug_report'
down_revision: Union[str, None] = '0013_lean_search_storage'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bug_report",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("steps", sa.Text(), nullable=True),
        sa.Column("area", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("page_url", sa.String(length=512), nullable=True),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        sa.Column("reporter_username", sa.String(length=128), nullable=False),
        sa.Column("reporter_role", sa.String(length=32), nullable=True),
        sa.Column("reporter_email", sa.String(length=320), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("handled_by", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("status IN ('open', 'in_progress', 'resolved', 'closed')", name="ck_bug_report_status"),
        sa.CheckConstraint("severity IN ('low', 'medium', 'high', 'critical')", name="ck_bug_report_severity"),
    )
    op.create_index("ix_bug_report_status_created", "bug_report", ["status", "created_at"])
    op.create_index("ix_bug_report_reporter_created", "bug_report", ["reporter_username", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_bug_report_reporter_created", table_name="bug_report")
    op.drop_index("ix_bug_report_status_created", table_name="bug_report")
    op.drop_table("bug_report")
