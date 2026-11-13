"""Selections and joining: what became of each closed requirement.

A row is made by itself when a requirement is closed (app/services/selections.py). People then record the selected candidate, the status
(offer pending, offer released, joined, backed out) and a comment.
* Recruiters do not see this page (every endpoint refuses them). A recruitment manager or sales manager sees the selections of their own
  location; the EVP and the admin both locations (and may look at one).
* Each of those roles writes the candidate, the status, the comments and the date, and may delete a row.
"""
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_
from sqlmodel import Session, select

from app.api.deps import require_core_app
from app.api.routers.tracker import MAX_COMMENT, _clean, _like, _names, _scope_location
from app.db.database import get_session
from app.models.selection import SELECTION_STATUSES, Selection, SelectionRecruiter
from app.models.user import User
from app.security.logsafe import security_event
from app.security.rbac_rules import ALL_LOCATIONS_ROLES, LOCATIONS, SELECTION_FIELD_EDITORS, SELECTION_ROLES

router = APIRouter(prefix="/api/tracker/selections", tags=["tracker"])

MAX_CANDIDATE = 160
SelectionStatus = Literal["offer_pending", "offer_released", "joined", "backed_out"]


def require_selection_role(user: User = Depends(require_core_app)) -> User:
    """Selections and joining is for the sales manager, recruitment manager, EVP and admin: a recruiter is refused."""
    if user.role not in SELECTION_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Selections and joining is not available to your role.")
    return user


FIELD_NAME = {"selection_date": "the date", "candidate_name": "the candidate", "status": "the status", "comments": "the comments"}


class Filters(BaseModel):
    q: Optional[str] = None
    status: Optional[str] = None
    location: Optional[str] = None             # the EVP and the admin may look at one location; for everyone else it changes nothing
    recruiter_id: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None


def _filters(
    q: Optional[str] = Query(None, max_length=100),
    status_: Optional[str] = Query(None, alias="status", max_length=16),
    location: Optional[str] = Query(None, max_length=32),
    recruiter_id: Optional[str] = Query(None, max_length=36),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> Filters:
    return Filters(q=q, status=status_, location=location, recruiter_id=recruiter_id, date_from=date_from, date_to=date_to)


class SelectionPatch(BaseModel):
    """Only the fields that are sent are changed; sending null clears the candidate or the comments."""
    selection_date: Optional[date] = None
    candidate_name: Optional[str] = None
    status: Optional[SelectionStatus] = None
    comments: Optional[str] = None

    @field_validator("candidate_name", mode="before")
    @classmethod
    def _candidate(cls, v):
        return _clean(v, MAX_CANDIDATE) if isinstance(v, str) or v is None else v

    @field_validator("comments", mode="before")
    @classmethod
    def _comments(cls, v):
        return _clean(v, MAX_COMMENT) if isinstance(v, str) or v is None else v

    @field_validator("selection_date")
    @classmethod
    def _sane_date(cls, v):
        if v is not None and not (2000 <= v.year <= 2100):
            raise ValueError("That date does not look right")
        return v


def _conditions(user: User, f: Filters, with_status: bool) -> list:
    """What this person may see, and the filters (the status one only when ``with_status``: the top counts ignore it)."""
    conds: list = []
    own = _scope_location(user)
    if own is not None:
        conds.append(Selection.location == own)                                # a location-bound person is held to it, whatever the address says
    elif f.location in LOCATIONS:
        conds.append(Selection.location == f.location)
    if f.recruiter_id:
        conds.append(Selection.id.in_(select(SelectionRecruiter.selection_id).where(SelectionRecruiter.recruiter_id == f.recruiter_id)))
    if with_status and f.status in SELECTION_STATUSES:
        conds.append(Selection.status == f.status)
    if f.date_from:
        conds.append(Selection.selection_date >= f.date_from)
    if f.date_to:
        conds.append(Selection.selection_date <= f.date_to)
    term = (f.q or "").replace("\x00", "").strip()
    if term:
        like = _like(term)
        conds.append(or_(
            Selection.candidate_name.ilike(like, escape="\\"), Selection.position.ilike(like, escape="\\"), Selection.client.ilike(like, escape="\\"),
            Selection.comments.ilike(like, escape="\\"),
            Selection.id.in_(select(SelectionRecruiter.selection_id).where(
                SelectionRecruiter.recruiter_id.in_(select(User.id).where(User.username.ilike(like, escape="\\")))))))
    return conds


def _person(names: Dict[str, str], user_id: Optional[str]) -> Optional[Dict[str, str]]:
    return {"id": user_id, "username": names.get(user_id) or "Former user"} if user_id else None


def _views(session: Session, rows: List[Selection]) -> List[Dict[str, Any]]:
    links: Dict[str, List[str]] = {r.id: [] for r in rows}
    ids = list(links)
    for i in range(0, len(ids), 400):
        for link in session.exec(select(SelectionRecruiter).where(SelectionRecruiter.selection_id.in_(ids[i:i + 400]))
                                 .order_by(SelectionRecruiter.position, SelectionRecruiter.recruiter_id)).all():
            links[link.selection_id].append(link.recruiter_id)
    names = _names(session, [x for rs in links.values() for x in rs] + [r.sales_manager_id for r in rows] + [r.manager_id for r in rows])
    return [{
        "id": r.id,
        "requirement_id": r.requirement_id,
        "date": r.selection_date.isoformat(),
        "candidate_name": r.candidate_name,
        "position": r.position,
        "client": r.client,
        "status": r.status,
        "recruiters": [_person(names, rid) for rid in links[r.id]],
        "sales_manager": _person(names, r.sales_manager_id),             # shown as the Account Manager
        "manager": _person(names, r.manager_id),                         # the recruitment manager
        "comments": r.comments,
        "updated_by": r.updated_by,
        "updated_at": r.updated_at.isoformat() + "Z",
    } for r in rows]


def _get_visible(session: Session, user: User, selection_id: str, lock: bool = False) -> Selection:
    row = session.get(Selection, selection_id, with_for_update=lock) if selection_id and len(selection_id) <= 36 else None
    if row is not None:
        own = _scope_location(user)
        if own is not None and row.location != own:
            row = None
    if row is None:                                                          # one the person may not see is reported as missing
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selection not found")
    return row


@router.get("/options")
def options(user: User = Depends(require_selection_role), session: Session = Depends(get_session)):
    own = _scope_location(user) if user.role not in ALL_LOCATIONS_ROLES else None
    q = select(User).where(User.role == "user", User.is_active == True)   # noqa: E712
    if own is not None:
        q = q.where(User.location == own)
    recruiters = [{"id": u.id, "username": u.username, "location": u.location}
                  for u in session.exec(q.order_by(func.lower(User.username))).all() if u.location in LOCATIONS]
    return {
        "statuses": list(SELECTION_STATUSES),
        "locations": list(LOCATIONS),
        "all_locations": own is None,
        "editable": {k: user.role in v for k, v in SELECTION_FIELD_EDITORS.items()},
        "recruiters": recruiters,
    }


@router.get("")
def list_selections(
    f: Filters = Depends(_filters),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0, le=100000),
    user: User = Depends(require_selection_role),
    session: Session = Depends(get_session),
):
    """The selections (newest first), and the counts for the cards at the top: all of them and each status (the status filter does not change those)."""
    conds = _conditions(user, f, with_status=True)
    total = session.exec(select(func.count()).select_from(Selection).where(*conds)).one()
    rows = session.exec(select(Selection).where(*conds).order_by(Selection.selection_date.desc(), Selection.created_at.desc(), Selection.id)
                        .offset(offset).limit(limit)).all()
    counts = dict(session.exec(select(Selection.status, func.count()).where(*_conditions(user, f, with_status=False)).group_by(Selection.status)).all())
    stats = {s: int(counts.get(s, 0)) for s in SELECTION_STATUSES}
    stats["total"] = sum(stats.values())
    return {"items": _views(session, list(rows)), "total": int(total), "stats": stats}


@router.get("/{selection_id}")
def get_selection(selection_id: str, user: User = Depends(require_selection_role), session: Session = Depends(get_session)):
    return _views(session, [_get_visible(session, user, selection_id)])[0]


@router.patch("/{selection_id}")
def update_selection(selection_id: str, body: SelectionPatch, user: User = Depends(require_selection_role), session: Session = Depends(get_session)):
    row = _get_visible(session, user, selection_id, lock=True)
    sent = set(body.model_fields_set)
    for name in sent:
        if user.role not in SELECTION_FIELD_EDITORS.get(name, ()):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Your role cannot change {FIELD_NAME.get(name, name)}.")
    if "status" in sent and body.status is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The status cannot be empty.")
    if "selection_date" in sent and body.selection_date is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The date cannot be empty.")
    changed = []
    for name in ("selection_date", "candidate_name", "status", "comments"):
        if name in sent and getattr(row, name) != getattr(body, name):
            setattr(row, name, getattr(body, name))
            changed.append(name)
    if changed:
        row.updated_by, row.updated_at = user.username, datetime.utcnow()
        session.add(row)
        session.commit()
        session.refresh(row)
        security_event("selection_updated", by=user.username, selection=row.id, fields=",".join(changed))
    return _views(session, [row])[0]


@router.delete("/{selection_id}", status_code=204)
def delete_selection(selection_id: str, user: User = Depends(require_selection_role), session: Session = Depends(get_session)):
    row = _get_visible(session, user, selection_id, lock=True)
    session.execute(SelectionRecruiter.__table__.delete().where(SelectionRecruiter.__table__.c.selection_id == row.id))
    session.delete(row)
    session.commit()
    security_event("selection_deleted", by=user.username, selection=selection_id)
    return Response(status_code=204)
