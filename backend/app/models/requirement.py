"""The requirements tracker: a client requirement a sales manager receives, who it is assigned to, and what happened to it.

``requirement`` is one row per requirement. ``requirement_event`` is its history (who changed what, from what to what), so the
tracker keeps track of everything. The job description itself lives in the JD library (``jd_id``); a requirement only points at it.
"""
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text
from sqlmodel import Field, SQLModel

from app.security.rbac_rules import LOCATIONS

REQUIREMENT_STATUSES = ("open", "submitted", "hold", "closed", "canceled")
DURATION_TYPES = ("full_time", "fixed")
DURATION_UNITS = ("days", "months", "years")
MAX_DURATION = 31
MAX_CVS_SUBMITTED = 100000


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class Requirement(SQLModel, table=True):
    __tablename__ = "requirement"
    __table_args__ = (
        CheckConstraint(_in("status", REQUIREMENT_STATUSES), name="ck_requirement_status"),
        CheckConstraint(_in("location", LOCATIONS), name="ck_requirement_location"),
        CheckConstraint("duration_type IS NULL OR " + _in("duration_type", DURATION_TYPES), name="ck_requirement_duration_type"),
        CheckConstraint("duration_unit IS NULL OR " + _in("duration_unit", DURATION_UNITS), name="ck_requirement_duration_unit"),
        CheckConstraint(f"duration_value IS NULL OR duration_value BETWEEN 1 AND {MAX_DURATION}", name="ck_requirement_duration_value"),
        Index("ix_requirement_location_status", "location", "status"),
        Index("ix_requirement_recruiter", "recruiter_id", "status"),
        Index("ix_requirement_manager", "manager_id"),
        Index("ix_requirement_sales_manager", "sales_manager_id"),
        Index("ix_requirement_date", "requirement_date"),
        Index("ix_requirement_closed", "status", "closed_at"),
    )

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), sa_column=Column(String(36), primary_key=True))
    # Which team's requirement this is (Dubai or Abu Dhabi), and so who may see it. Nobody types it: it is the location of the person who
    # added it, or, for the EVP and the admin (who have none), of the recruiter it is assigned to. Empty until then: only the EVP and the
    # admin see such a requirement.
    location: Optional[str] = Field(default=None, sa_column=Column(String(32), nullable=True))
    requirement_date: date = Field(sa_column=Column(Date, nullable=False))
    position: str = Field(sa_column=Column(String(160), nullable=False))
    client: str = Field(sa_column=Column(String(160), nullable=False))
    job_location: Optional[str] = Field(default=None, sa_column=Column(String(160), nullable=True))     # where the job is (a city, a country)
    salary: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))            # as the client gives it: 12,000 or 10,000 - 14,000 AED
    # how long the job lasts: nothing chosen, 'full_time' (no end date), or 'fixed' (a number of days, months or years, which may be extended)
    duration_type: Optional[str] = Field(default=None, sa_column=Column(String(12), nullable=True))
    duration_value: Optional[int] = Field(default=None, sa_column=Column(SmallInteger, nullable=True))   # 1 to 31, only for 'fixed'
    duration_unit: Optional[str] = Field(default=None, sa_column=Column(String(8), nullable=True))       # days | months | years, only for 'fixed'
    duration_extendable: Optional[bool] = Field(default=None, sa_column=Column(Boolean, nullable=True))  # only for 'fixed'
    # the job description in the JD library (kept as text: the requirement outlives a JD that is later removed)
    jd_id: Optional[str] = Field(default=None, sa_column=Column(String(36), nullable=True))
    jd_filename: Optional[str] = Field(default=None, sa_column=Column(String(255), nullable=True))
    sales_comments: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    rm_comments: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    recruiter_comments: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    # the job the recruiter posted in Careers from this requirement's job description (empty until they click Post job)
    job_id: Optional[str] = Field(default=None, sa_column=Column(String(36), nullable=True))
    cv_submission_date: Optional[date] = Field(default=None, sa_column=Column(Date, nullable=True))
    # the LEAD recruiter: the first of the recruiters assigned (see ``requirement_recruiter``), who is credited when it is closed. None when nobody is assigned.
    recruiter_id: Optional[str] = Field(default=None, sa_column=Column(String(36), nullable=True))
    # the recruitment manager this requirement is assigned to (a user with the role manager, of the requirement's location); None when nobody is
    manager_id: Optional[str] = Field(default=None, sa_column=Column(String(36), nullable=True))
    # the sales manager who owns the requirement (a user with the role account_manager): the one who added it, unless another was chosen
    sales_manager_id: Optional[str] = Field(default=None, sa_column=Column(String(36), nullable=True))
    status: str = Field(default="open", sa_column=Column(String(16), nullable=False, server_default="open"))
    # when the requirement was closed and by whom; empty while it is not closed. The recruiter it is credited to is ``recruiter_id``
    # (a closed requirement keeps its recruiter: reopen it to change that).
    closed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    closed_by: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    created_by: str = Field(sa_column=Column(String(64), nullable=False))          # the sales manager (username)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False))
    updated_by: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False))


class RequirementEvent(SQLModel, table=True):
    __tablename__ = "requirement_event"
    __table_args__ = (Index("ix_requirement_event_req_at", "requirement_id", "at"),)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), sa_column=Column(String(36), primary_key=True))
    requirement_id: str = Field(sa_column=Column(String(36), ForeignKey("requirement.id", ondelete="CASCADE"), nullable=False))
    at: datetime = Field(default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False))
    actor: str = Field(sa_column=Column(String(64), nullable=False))
    action: str = Field(sa_column=Column(String(16), nullable=False))              # created | changed
    field: Optional[str] = Field(default=None, sa_column=Column(String(32), nullable=True))
    old_value: Optional[str] = Field(default=None, sa_column=Column(String(500), nullable=True))
    new_value: Optional[str] = Field(default=None, sa_column=Column(String(500), nullable=True))


class RequirementRecruiter(SQLModel, table=True):
    """One recruiter assigned to a requirement. A requirement may have several; ``position`` 0 is the lead (``requirement.recruiter_id``).
    What a recruiter has sent to the client, the day they submitted CVs and how many, is each recruiter's own, so it lives here."""
    __tablename__ = "requirement_recruiter"
    __table_args__ = (
        CheckConstraint(f"cvs_submitted_count IS NULL OR cvs_submitted_count BETWEEN 0 AND {MAX_CVS_SUBMITTED}", name="ck_requirement_recruiter_cvs"),
        Index("ix_requirement_recruiter_user", "recruiter_id"),
    )

    requirement_id: str = Field(sa_column=Column(String(36), ForeignKey("requirement.id", ondelete="CASCADE"), primary_key=True))
    recruiter_id: str = Field(sa_column=Column(String(36), primary_key=True))
    position: int = Field(default=0, sa_column=Column(SmallInteger, nullable=False, server_default="0"))
    cvs_submitted_date: Optional[date] = Field(default=None, sa_column=Column(Date, nullable=True))
    cvs_submitted_count: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
