"""Bug reports. Everyone who is signed in can report a bug and follow their own reports; the admin sees all of them, changes their
status, answers them and deletes them. Reports live in their own table (``bug_report``)."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_
from sqlmodel import Session, select

from app.api.deps import require_admin, require_user
from app.db.database import get_session
from app.models.bug_report import BUG_AREAS, BUG_SEVERITIES, BUG_STATUSES, BugReport
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Bug reports"])

MAX_REPORTS_PER_HOUR = 10                      # a person cannot flood the admin's list
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

Severity = Literal["low", "medium", "high", "critical"]
Status = Literal["open", "in_progress", "resolved", "closed"]


def _clean(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = _CONTROL.sub("", value).strip()
    return value or None


class BugCreate(BaseModel):
    title: str = Field(..., min_length=5, max_length=160)
    description: str = Field(..., min_length=10, max_length=4000)
    steps: Optional[str] = Field(default=None, max_length=3000)
    area: str = Field(default="Other", max_length=32)
    severity: Severity = "medium"

    @field_validator("title", "description", mode="before")
    @classmethod
    def _text(cls, v):
        return _clean(v) if isinstance(v, str) else v

    @field_validator("steps", mode="before")
    @classmethod
    def _optional_text(cls, v):
        return _clean(v) if isinstance(v, str) else v

    @field_validator("area")
    @classmethod
    def _known_area(cls, v: str) -> str:
        if v not in BUG_AREAS:
            raise ValueError(f"area must be one of: {', '.join(BUG_AREAS)}")
        return v


class BugUpdate(BaseModel):
    status: Optional[Status] = None
    severity: Optional[Severity] = None
    admin_note: Optional[str] = Field(default=None, max_length=3000)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() + "Z" if value else None


def _mine(row: BugReport) -> dict:
    """What the reporter sees of their own report."""
    return {
        "id": row.id, "title": row.title, "description": row.description, "steps": row.steps, "area": row.area, "severity": row.severity,
        "status": row.status, "admin_note": row.admin_note, "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
        "resolved_at": _iso(row.resolved_at),
    }


def _admin_view(row: BugReport) -> dict:
    return {**_mine(row), "user_agent": row.user_agent, "reporter_username": row.reporter_username,
            "reporter_role": row.reporter_role, "reporter_email": row.reporter_email, "handled_by": row.handled_by}


@router.post("/bugs", status_code=status.HTTP_201_CREATED)
def report_bug(data: BugCreate, request: Request, user: User = Depends(require_user), session: Session = Depends(get_session)) -> dict:
    """Send a bug report. The reporter is whoever is signed in."""
    since = datetime.utcnow() - timedelta(hours=1)
    recent = session.exec(select(func.count()).select_from(BugReport).where(
        BugReport.reporter_username == user.username, BugReport.created_at >= since)).one()
    if int(recent or 0) >= MAX_REPORTS_PER_HOUR:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail=f"You have sent {MAX_REPORTS_PER_HOUR} reports in the last hour. Please try again later.")
    row = BugReport(
        title=data.title, description=data.description, steps=data.steps, area=data.area, severity=data.severity,
        user_agent=_clean((request.headers.get("user-agent") or "")[:300]),
        reporter_username=user.username, reporter_role=getattr(user, "role", None), reporter_email=getattr(user, "email", None),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    logger.info("Bug report %s from %s (%s, %s)", row.id, user.username, row.area, row.severity)
    return _mine(row)


@router.get("/bugs/mine")
def my_bug_reports(
    limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
    user: User = Depends(require_user), session: Session = Depends(get_session),
) -> dict:
    """The signed-in person's own reports, newest first."""
    mine = BugReport.reporter_username == user.username
    total = int(session.exec(select(func.count()).select_from(BugReport).where(mine)).one() or 0)
    rows = session.exec(select(BugReport).where(mine).order_by(BugReport.created_at.desc(), BugReport.id).offset(offset).limit(limit)).all()
    return {"items": [_mine(r) for r in rows], "total": total}


@router.get("/admin/bugs")
def list_bug_reports(
    q: Optional[str] = Query(None, max_length=200), status_filter: Literal["all", *BUG_STATUSES] = Query("all", alias="status"),
    severity: Literal["all", *BUG_SEVERITIES] = "all", area: Optional[str] = Query(None, max_length=32),
    limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
    _: User = Depends(require_admin), session: Session = Depends(get_session),
) -> dict:
    """Every report, newest first, with the number in each status (counted over the same search and filters, whatever the status tab)."""
    conds = []
    if q and q.strip():
        needle = f"%{q.strip().lower()}%"
        conds.append(or_(func.lower(BugReport.title).like(needle), func.lower(BugReport.description).like(needle),
                         func.lower(BugReport.reporter_username).like(needle)))
    if severity != "all":
        conds.append(BugReport.severity == severity)
    if area:
        conds.append(BugReport.area == area)
    counts: Dict[str, int] = {s: 0 for s in BUG_STATUSES}
    for state, n in session.exec(select(BugReport.status, func.count()).where(*conds).group_by(BugReport.status)).all():
        counts[state] = int(n)
    counts["all"] = sum(counts.values())
    page_conds = conds + ([BugReport.status == status_filter] if status_filter != "all" else [])
    rows = session.exec(select(BugReport).where(*page_conds).order_by(BugReport.created_at.desc(), BugReport.id)
                        .offset(offset).limit(limit)).all()
    return {"items": [_admin_view(r) for r in rows], "total": counts[status_filter], "counts": counts}


@router.get("/admin/bugs/open-count")
def open_bug_count(_: User = Depends(require_admin), session: Session = Depends(get_session)) -> dict:
    """How many reports still wait for the admin (the badge in the side menu)."""
    n = session.exec(select(func.count()).select_from(BugReport).where(BugReport.status == "open")).one()
    return {"open": int(n or 0)}


@router.patch("/admin/bugs/{bug_id}")
def update_bug_report(bug_id: str, data: BugUpdate, admin: User = Depends(require_admin), session: Session = Depends(get_session)) -> dict:
    row = session.get(BugReport, bug_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bug report not found")
    now = datetime.utcnow()
    if data.status is not None and data.status != row.status:
        row.status = data.status
        row.resolved_at = now if data.status in ("resolved", "closed") else None
    if data.severity is not None:
        row.severity = data.severity
    if "admin_note" in data.model_fields_set:
        row.admin_note = _clean(data.admin_note)
    row.handled_by, row.updated_at = admin.username, now
    session.add(row)
    session.commit()
    session.refresh(row)
    return _admin_view(row)


@router.delete("/admin/bugs/{bug_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bug_report(bug_id: str, _: User = Depends(require_admin), session: Session = Depends(get_session)) -> None:
    row = session.get(BugReport, bug_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bug report not found")
    session.delete(row)
    session.commit()
