"""In-app notifications: the bell at the top of every page.

One row per person per event (a requirement assigned to them, their bug report answered ...). ``read_at`` is empty until they open it.
Nothing is kept longer than NOTIFICATION_RETENTION_DAYS (30): the API never returns older rows and the background worker deletes them,
so the table cannot grow without limit (see app/services/notifications.py).
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime, ForeignKey, Index, String
from sqlmodel import Field, SQLModel

NOTIFICATION_KINDS = ("requirement_assigned", "requirement_closed", "requirement_status", "bug_status", "bug_reply", "bug_reported")


class Notification(SQLModel, table=True):
    __tablename__ = "notification"
    __table_args__ = (
        Index("ix_notification_user_created", "user_id", "created_at"),   # a person's list, newest first
        Index("ix_notification_user_unread", "user_id", "read_at"),        # the bell's count
        Index("ix_notification_created", "created_at"),                    # the 30-day clean-up
    )

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), sa_column=Column(String(36), primary_key=True))
    # who it is for; a user is never deleted (only deactivated), the cascade is for safety
    user_id: str = Field(sa_column=Column(String(36), ForeignKey("user.id", ondelete="CASCADE"), nullable=False))
    kind: str = Field(sa_column=Column(String(32), nullable=False))
    title: str = Field(sa_column=Column(String(200), nullable=False))
    body: Optional[str] = Field(default=None, sa_column=Column(String(500), nullable=True))
    link: Optional[str] = Field(default=None, sa_column=Column(String(300), nullable=True))     # the page it opens, e.g. /tracker?focus=<id>
    actor: Optional[str] = Field(default=None, sa_column=Column(String(128), nullable=True))   # who caused it (username)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False))
    read_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
