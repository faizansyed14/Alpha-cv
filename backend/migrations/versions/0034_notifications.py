"""In-app notifications (the bell)

A new table, nothing existing changes: one row per person per event, with when it was read. Rows older than 30 days are deleted by the
background worker.

Revision ID: 0034_notifications
Revises: 0033_same_person_cv
Create Date: 2026-11-18 14:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0034_notifications'
down_revision: Union[str, None] = '0033_same_person_cv'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.String(500), nullable=True),
        sa.Column("link", sa.String(300), nullable=True),
        sa.Column("actor", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_notification_user_created", "notification", ["user_id", "created_at"])
    op.create_index("ix_notification_user_unread", "notification", ["user_id", "read_at"])
    op.create_index("ix_notification_created", "notification", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_notification_created", table_name="notification")
    op.drop_index("ix_notification_user_unread", table_name="notification")
    op.drop_index("ix_notification_user_created", table_name="notification")
    op.drop_table("notification")
