"""Bug reports: what a signed-in person sends from the "Report a bug" page, and what the admin does with it. One row per report,
in its own table (nothing else in the database is touched)."""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, Column, DateTime, Index, String, Text
from sqlmodel import Field, SQLModel

BUG_STATUSES = ("open", "in_progress", "resolved", "closed")
BUG_SEVERITIES = ("low", "medium", "high", "critical")
BUG_AREAS = ("Dashboard", "Candidates", "Job descriptions", "Match", "Upload", "Careers", "Tracker", "AI agents", "Login or account", "Other")


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class BugReport(SQLModel, table=True):
    __tablename__ = "bug_report"
    __table_args__ = (
        CheckConstraint(_in("status", BUG_STATUSES), name="ck_bug_report_status"),
        CheckConstraint(_in("severity", BUG_SEVERITIES), name="ck_bug_report_severity"),
        Index("ix_bug_report_status_created", "status", "created_at"),
        Index("ix_bug_report_reporter_created", "reporter_username", "created_at"),
    )

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), sa_column=Column(String(36), primary_key=True))
    # what the reporter wrote
    title: str = Field(sa_column=Column(String(160), nullable=False))
    description: str = Field(sa_column=Column(Text, nullable=False))
    steps: Optional[str] = Field(default=None, sa_column=Column(Text))                  # how to make it happen again
    area: str = Field(default="Other", sa_column=Column(String(32), nullable=False))   # which part of the app
    severity: str = Field(default="medium", sa_column=Column(String(16), nullable=False))
    # what the browser said it was
    user_agent: Optional[str] = Field(default=None, sa_column=Column(String(300)))
    # who sent it (taken from the sign-in, never from the form)
    reporter_username: str = Field(sa_column=Column(String(128), nullable=False))
    reporter_role: Optional[str] = Field(default=None, sa_column=Column(String(32)))
    reporter_email: Optional[str] = Field(default=None, sa_column=Column(String(320)))
    # what the admin did with it
    status: str = Field(default="open", sa_column=Column(String(16), nullable=False, server_default="open"))
    admin_note: Optional[str] = Field(default=None, sa_column=Column(Text))
    handled_by: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False))
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    resolved_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
