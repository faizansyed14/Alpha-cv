"""Selections and joining: what became of a closed requirement.

When a requirement is closed a ``selection`` row is made for it (see ``app/services/selections.py``): the date, the position and client, and
the people it belonged to. The recruiters then record who was selected, whether the offer is pending or released, whether the candidate
joined or backed out, and a comment. A row keeps its own copy of the position and client, so it outlives a requirement that is later deleted.
"""
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import CheckConstraint, Column, Date, DateTime, ForeignKey, Index, SmallInteger, String, Text
from sqlmodel import Field, SQLModel

from app.security.rbac_rules import LOCATIONS

SELECTION_STATUSES = ("offer_pending", "offer_released", "joined", "backed_out")


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class Selection(SQLModel, table=True):
    __tablename__ = "selection"
    __table_args__ = (
        CheckConstraint(_in("status", SELECTION_STATUSES), name="ck_selection_status"),
        CheckConstraint("location IS NULL OR " + _in("location", LOCATIONS), name="ck_selection_location"),
        Index("ix_selection_location_date", "location", "selection_date"),
        Index("ix_selection_status", "status"),
        Index("ix_selection_date", "selection_date"),
    )

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), sa_column=Column(String(36), primary_key=True))
    # the requirement it came from: one selection per requirement (a requirement that is reopened and closed again keeps it). Not a foreign
    # key, so the row stays when the requirement is deleted.
    requirement_id: Optional[str] = Field(default=None, sa_column=Column(String(36), nullable=True, unique=True))
    # which team's it is, copied from the requirement: it decides who may see it
    location: Optional[str] = Field(default=None, sa_column=Column(String(32), nullable=True))
    selection_date: date = Field(sa_column=Column(Date, nullable=False))               # the day the requirement was closed
    candidate_name: Optional[str] = Field(default=None, sa_column=Column(String(160), nullable=True))
    position: str = Field(sa_column=Column(String(160), nullable=False))
    client: str = Field(sa_column=Column(String(160), nullable=False))
    status: str = Field(default="offer_pending", sa_column=Column(String(16), nullable=False, server_default="offer_pending"))
    sales_manager_id: Optional[str] = Field(default=None, sa_column=Column(String(36), nullable=True))      # the account manager
    manager_id: Optional[str] = Field(default=None, sa_column=Column(String(36), nullable=True))            # the recruitment manager
    comments: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False))
    updated_by: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column=Column(DateTime, nullable=False))


class SelectionRecruiter(SQLModel, table=True):
    """A recruiter the requirement was assigned to when it was closed (position 0 is the lead)."""
    __tablename__ = "selection_recruiter"
    __table_args__ = (Index("ix_selection_recruiter_user", "recruiter_id"),)

    selection_id: str = Field(sa_column=Column(String(36), ForeignKey("selection.id", ondelete="CASCADE"), primary_key=True))
    recruiter_id: str = Field(sa_column=Column(String(36), primary_key=True))
    position: int = Field(default=0, sa_column=Column(SmallInteger, nullable=False, server_default="0"))
