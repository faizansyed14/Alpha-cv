"""The requirements tracker.

A sales manager receives a requirement from a client and records it here: the position, the client, the job description, the dates and
who it is assigned to. The recruiter works on it and keeps its status and their comments up to date. Everything that changes is kept
in a history.

Who sees what:
* A recruiter, recruitment manager or sales manager works in one location (Dubai or Abu Dhabi, chosen when their login is created) and
  sees only that location's requirements. The EVP and the admin see every location. A requirement has no location field to fill in: it
  belongs to the location of the person who adds it, or, when the EVP or the admin adds it, of the recruiter it is assigned to (until
  one is assigned only the EVP and the admin see it, and assigning a recruiter of the other location moves it there).
* A recruiter sees only the requirements assigned to them, and not the sales manager's comments.
* Each field has its own editors (rbac_rules.REQUIREMENT_FIELD_EDITORS): the sales manager writes the sales manager comments, the
  recruitment manager the recruitment manager comments and the recruiter the recruiter comments. The status is changed by the recruiter
  and the recruitment manager. The EVP and the admin may change any field.
* The job description is uploaded, replaced and removed by the sales manager and the recruitment manager (and the EVP and admin), not by
  a recruiter, who can preview it and post the job in Careers. Replacing or removing it deactivates the job posted from it in Careers (it
  takes no new applications) and deletes nothing: the old description, the job and its applications all stay.
"""
import io
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Literal, Optional, Sequence

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, or_
from sqlmodel import Session, select

from app.api.deps import require_core_app
from app.db.database import get_session
from app.models.requirement import MAX_CVS_SUBMITTED, MAX_DURATION, REQUIREMENT_STATUSES, Requirement, RequirementEvent, RequirementRecruiter
from app.models.user import User
from app.security.logsafe import security_event
from app.services.selections import create_for_closed
from app.security.rbac_rules import ALL_LOCATIONS_ROLES, LOCATIONS, REQUIREMENT_FIELD_EDITORS, TRACKER_FULL_ROLES
from app.store import get_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tracker", tags=["tracker"])

Status = Literal["open", "submitted", "hold", "closed", "canceled"]
DurationType = Literal["full_time", "fixed"]
DurationUnit = Literal["days", "months", "years"]
MAX_COMMENT = 4000
MAX_JOB_LOCATION = 160
MAX_SALARY = 64
MAX_RECRUITERS = 10                                               # recruiters on one requirement
MAX_EXPORT_ROWS = 20000
FIELD_KEY = {"manager_id": "recruitment_manager", "sales_manager_id": "sales_manager", "recruiter_id": "recruiter", "jd_id": "jd", "duration_type": "duration", "duration_value": "duration",
             "duration_unit": "duration", "duration_extendable": "duration",
             "recruiter_ids": "recruiter", "cvs_submissions": "cvs_submitted"}          # request field -> name in REQUIREMENT_FIELD_EDITORS
FIELD_NAME = {
    "requirement_date": "the requirement date", "position": "the position", "client": "the client", "cv_submission_date": "the CV submission date",
    "job_location": "the job location", "salary": "the salary", "duration": "the job duration", "cvs_submitted": "the CVs submitted",
    "recruiter": "the assigned recruiter", "recruitment_manager": "the recruitment manager", "sales_manager": "the sales manager", "jd": "the job description", "sales_comments": "the sales manager comments",
    "rm_comments": "the recruitment manager comments", "recruiter_comments": "the recruiter comments", "status": "the status",
}
EVENT_TEXT = 480                                                  # history keeps at most this much of a changed text


# ----------------------------------------------------------------------------------------------------------------- who and where

def _is_recruiter(user: User) -> bool:
    return user.role == "user"


def _scope_location(user: User) -> Optional[str]:
    """The one location this person may see, or None for the EVP and the admin (every location)."""
    if user.role in ALL_LOCATIONS_ROLES:
        return None
    location = getattr(user, "location", None)
    if location not in LOCATIONS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Your account has no location, so it cannot see any requirements. Ask an administrator to set it.")
    return location


def _assignee_ids(session: Session, requirement_id: str) -> List[str]:
    """The ids of the recruiters assigned to a requirement, the lead first."""
    return list(session.exec(select(RequirementRecruiter.recruiter_id).where(RequirementRecruiter.requirement_id == requirement_id)
                             .order_by(RequirementRecruiter.position, RequirementRecruiter.recruiter_id)).all())


def _can_see(session: Session, user: User, req: Requirement) -> bool:
    location = _scope_location(user)
    if location is not None and req.location != location:
        return False
    if _is_recruiter(user) and user.id not in _assignee_ids(session, req.id):       # a recruiter sees the requirements they are one of the recruiters of
        return False
    return True


def _get_visible(session: Session, user: User, requirement_id: str, lock: bool = False) -> Requirement:
    """The requirement, if this person may see it. ``lock``: the row is locked (SELECT ... FOR UPDATE) until the transaction ends, so two people changing
    the same requirement at the same moment take turns, and the second works on what the first left (two closes close it once)."""
    req = session.get(Requirement, requirement_id, with_for_update=lock) if requirement_id and len(requirement_id) <= 36 else None
    # a requirement the person may not see is reported as missing, not as forbidden
    if req is None or not _can_see(session, user, req):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")
    return req


def _check_editable(user: User, fields) -> None:
    """Refuse when the person may not change one of these fields (names as sent in the request)."""
    for name in fields:
        key = FIELD_KEY.get(name, name)
        editors = REQUIREMENT_FIELD_EDITORS.get(key)
        if editors is not None and user.role not in editors:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Your role cannot change {FIELD_NAME.get(key, key)}.")


def _deactivate_replaced_job(job_id: str, actor: str) -> None:
    """The job description was replaced or removed: the job posted from it stops taking applications. Nothing is deleted: the job, its
    applications, the CVs and the old description all stay, and the job can be switched on again in Careers."""
    try:
        if get_store().update_job_posting(job_id, {"is_active": False}):
            security_event("job_deactivated", by=actor, job=job_id, reason="description_replaced")
    except Exception as exc:  # noqa: BLE001 - the replacement is saved; this is logged rather than shown as a failure of the save
        logger.error(f"Could not deactivate job {job_id} after its description was replaced: {exc}")


def _require_full(user: User, what: str) -> None:
    if user.role not in TRACKER_FULL_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Only a sales manager, recruitment manager, EVP or admin can {what}.")


# ----------------------------------------------------------------------------------------------------------------- shapes

def _clean(value: Optional[str], limit: int) -> Optional[str]:
    if value is None:
        return None
    value = value.replace("\x00", "").strip()
    if len(value) > limit:
        raise ValueError(f"Keep this to {limit} characters or fewer")
    return value or None


def _required_text(v):
    v = v.replace("\x00", "").strip() if isinstance(v, str) else v
    if not v:
        raise ValueError("This is required")
    return v


def _duration(kind: Optional[str], value: Optional[int], unit: Optional[str], extendable: Optional[bool]) -> tuple:
    """The four duration fields as they are stored. Nothing chosen clears them; full time has no number, unit or extension; a fixed duration
    needs a number (1 to 31) and days, months or years, and says whether it may be extended."""
    if kind is None:
        return None, None, None, None
    if kind == "full_time":
        return "full_time", None, None, None
    if value is None or unit is None:
        raise ValueError(f"Choose how long the job lasts: a number from 1 to {MAX_DURATION} and days, months or years.")
    return "fixed", value, unit, bool(extendable)


def _duration_text(kind: Optional[str], value: Optional[int], unit: Optional[str], extendable: Optional[bool]) -> Optional[str]:
    """The duration in words, for the history: "Full time", "6 months, extendable", "1 year, not extendable"."""
    if kind == "full_time":
        return "Full time"
    if kind == "fixed" and value and unit:
        return f"{value} {unit[:-1] if value == 1 else unit}, {'extendable' if extendable else 'not extendable'}"
    return None


class RequirementIn(BaseModel):
    requirement_date: date
    position: str = Field(..., min_length=1, max_length=160)
    client: str = Field(..., min_length=1, max_length=160)
    job_location: Optional[str] = None             # where the job is
    salary: Optional[str] = None
    duration_type: Optional[DurationType] = None   # nothing, full time, or fixed (then a number and a unit)
    duration_value: Optional[int] = Field(default=None, ge=1, le=MAX_DURATION)
    duration_unit: Optional[DurationUnit] = None
    duration_extendable: Optional[bool] = None
    jd_id: Optional[str] = Field(default=None, max_length=36)
    sales_comments: Optional[str] = None
    rm_comments: Optional[str] = None
    recruiter_comments: Optional[str] = None
    cv_submission_date: Optional[date] = None
    recruiter_id: Optional[str] = Field(default=None, max_length=36)                     # one recruiter (kept for callers that send one) ...
    recruiter_ids: Optional[List[str]] = Field(default=None, max_length=MAX_RECRUITERS)   # ... or several: the first is the lead
    manager_id: Optional[str] = Field(default=None, max_length=36)                       # the recruitment manager
    sales_manager_id: Optional[str] = Field(default=None, max_length=36)                 # the sales manager (the creator, when they are one, if not sent)
    status: Status = "open"

    @model_validator(mode="after")
    def _normal_duration(self):
        self.duration_type, self.duration_value, self.duration_unit, self.duration_extendable = _duration(
            self.duration_type, self.duration_value, self.duration_unit, self.duration_extendable)
        return self

    @field_validator("position", "client", mode="before")
    @classmethod
    def _required(cls, v):
        return _required_text(v)

    @field_validator("sales_comments", "rm_comments", "recruiter_comments", mode="before")
    @classmethod
    def _comment(cls, v):
        return _clean(v, MAX_COMMENT) if isinstance(v, str) or v is None else v

    @field_validator("job_location", mode="before")
    @classmethod
    def _job_location(cls, v):
        return _clean(v, MAX_JOB_LOCATION) if isinstance(v, str) or v is None else v

    @field_validator("salary", mode="before")
    @classmethod
    def _salary(cls, v):
        return _clean(v, MAX_SALARY) if isinstance(v, str) or v is None else v

    @field_validator("jd_id", "recruiter_id", "manager_id", "sales_manager_id", mode="before")
    @classmethod
    def _blank_id(cls, v):
        return (v.strip() or None) if isinstance(v, str) else v

    @field_validator("recruiter_ids", mode="before")
    @classmethod
    def _ids(cls, v):
        return _clean_ids(v)

    @field_validator("requirement_date", "cv_submission_date")
    @classmethod
    def _sane_date(cls, v):
        if v is not None and not (2000 <= v.year <= 2100):
            raise ValueError("That date does not look right")
        return v


def _clean_ids(v):
    """A list of ids with blanks and repeats taken out, in the order given."""
    if not isinstance(v, list):
        return v
    out: List[str] = []
    for item in v:
        text = item.strip() if isinstance(item, str) else item
        if isinstance(text, str) and text and len(text) <= 36 and text not in out:
            out.append(text)
    return out


Day = date                  # CvsSubmission has a field called ``date``, which would otherwise hide the type of the same name from pydantic


class CvsSubmission(BaseModel):
    """What one recruiter has submitted. Only the fields that are sent are changed; null clears one."""
    recruiter_id: str = Field(..., min_length=1, max_length=36)
    date: Optional[Day] = None
    count: Optional[int] = Field(default=None, ge=0, le=MAX_CVS_SUBMITTED)

    @field_validator("date")
    @classmethod
    def _sane_day(cls, v):
        if v is not None and not (2000 <= v.year <= 2100):
            raise ValueError("That date does not look right")
        return v


class RequirementPatch(BaseModel):
    """Only the fields that are sent are changed; sending null clears an optional field."""
    requirement_date: Optional[date] = None
    position: Optional[str] = Field(default=None, max_length=160)
    client: Optional[str] = Field(default=None, max_length=160)
    job_location: Optional[str] = None
    salary: Optional[str] = None
    duration_type: Optional[DurationType] = None
    duration_value: Optional[int] = Field(default=None, ge=1, le=MAX_DURATION)
    duration_unit: Optional[DurationUnit] = None
    duration_extendable: Optional[bool] = None
    jd_id: Optional[str] = Field(default=None, max_length=36)
    sales_comments: Optional[str] = None
    rm_comments: Optional[str] = None
    recruiter_comments: Optional[str] = None
    cv_submission_date: Optional[date] = None
    recruiter_id: Optional[str] = Field(default=None, max_length=36)
    recruiter_ids: Optional[List[str]] = Field(default=None, max_length=MAX_RECRUITERS)
    manager_id: Optional[str] = Field(default=None, max_length=36)
    sales_manager_id: Optional[str] = Field(default=None, max_length=36)
    # the day each recruiter submitted CVs and how many: a recruiter sends their own, a manager (or the EVP, the admin) any assigned recruiter's
    cvs_submissions: Optional[List["CvsSubmission"]] = Field(default=None, max_length=MAX_RECRUITERS)
    status: Optional[Status] = None

    @field_validator("position", "client", mode="before")
    @classmethod
    def _text(cls, v):
        return _required_text(v) if v is not None else v

    @field_validator("sales_comments", "rm_comments", "recruiter_comments", mode="before")
    @classmethod
    def _comment(cls, v):
        return _clean(v, MAX_COMMENT) if isinstance(v, str) or v is None else v

    @field_validator("job_location", mode="before")
    @classmethod
    def _job_location(cls, v):
        return _clean(v, MAX_JOB_LOCATION) if isinstance(v, str) or v is None else v

    @field_validator("salary", mode="before")
    @classmethod
    def _salary(cls, v):
        return _clean(v, MAX_SALARY) if isinstance(v, str) or v is None else v

    @field_validator("jd_id", "recruiter_id", "manager_id", "sales_manager_id", mode="before")
    @classmethod
    def _blank_id(cls, v):
        return (v.strip() or None) if isinstance(v, str) else v

    @field_validator("recruiter_ids", mode="before")
    @classmethod
    def _ids(cls, v):
        return _clean_ids(v)

    @field_validator("requirement_date", "cv_submission_date")
    @classmethod
    def _sane_date(cls, v):
        if v is not None and not (2000 <= v.year <= 2100):
            raise ValueError("That date does not look right")
        return v


class PostedIn(BaseModel):
    job_id: str = Field(..., min_length=1, max_length=36)


def _names(session: Session, ids) -> Dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.username for u in session.exec(select(User).where(User.id.in_(ids))).all()}


def _days_to_close(req: Requirement) -> Optional[int]:
    """Days from the requirement date to the day it was closed (never negative)."""
    if req.status != "closed" or req.closed_at is None:
        return None
    return max(0, (req.closed_at.date() - req.requirement_date).days)


def _links_for(session: Session, ids: Sequence[str]) -> Dict[str, List[RequirementRecruiter]]:
    """The recruiters of each requirement (the lead first), loaded together."""
    out: Dict[str, List[RequirementRecruiter]] = defaultdict(list)
    ids = list(ids)
    for i in range(0, len(ids), 400):
        for link in session.exec(select(RequirementRecruiter).where(RequirementRecruiter.requirement_id.in_(ids[i:i + 400]))
                                 .order_by(RequirementRecruiter.position, RequirementRecruiter.recruiter_id)).all():
            out[link.requirement_id].append(link)
    return out


def _cvs_summary(links: Sequence[RequirementRecruiter], user: User) -> tuple:
    """(the latest day CVs were submitted, how many in all). A recruiter sees their own numbers; everyone else the total over the recruiters."""
    shown = [l for l in links if l.recruiter_id == user.id] if _is_recruiter(user) else list(links)
    counts = [l.cvs_submitted_count for l in shown if l.cvs_submitted_count is not None]
    days = [l.cvs_submitted_date for l in shown if l.cvs_submitted_date]
    return (max(days) if days else None), (sum(counts) if counts else None)


def _who(names: Dict[str, str], user_id: Optional[str]) -> str:
    """A person's name for the Excel files: Unassigned when nobody is chosen."""
    return (names.get(user_id) or "Former user") if user_id else "Unassigned"


def _recruiters_text(req: Requirement, links: Sequence[RequirementRecruiter], names: Dict[str, str]) -> str:
    """The recruiters' names, the lead first, for the Excel files."""
    return ", ".join(names.get(l.recruiter_id) or "Former user" for l in links) or "Unassigned"


def _view(req: Requirement, names: Dict[str, str], user: User, links: Sequence[RequirementRecruiter] = ()) -> Dict[str, Any]:
    team = []
    for link in links:
        own = not _is_recruiter(user) or link.recruiter_id == user.id         # a recruiter sees only their own CV numbers, not their colleagues'
        team.append({"id": link.recruiter_id, "username": names.get(link.recruiter_id) or "Former user",
                     "cvs_submitted_date": link.cvs_submitted_date.isoformat() if own and link.cvs_submitted_date else None,
                     "cvs_submitted_count": link.cvs_submitted_count if own else None})
    lead = None
    if req.recruiter_id:
        lead = {"id": req.recruiter_id, "username": names.get(req.recruiter_id) or "Former user"}
    cvs_day, cvs_count = _cvs_summary(links, user)
    return {
        "id": req.id,
        "location": req.location,                  # which team's it is (not shown on the page: it follows the people, see the module note)
        "requirement_date": req.requirement_date.isoformat(),
        "position": req.position,
        "client": req.client,
        "job_location": req.job_location,
        "salary": req.salary,
        "duration_type": req.duration_type,
        "duration_value": req.duration_value,
        "duration_unit": req.duration_unit,
        "duration_extendable": req.duration_extendable,
        "jd_id": req.jd_id,
        "jd_filename": req.jd_filename,
        # a recruiter does not see what the sales manager wrote for the managers
        "sales_comments": None if _is_recruiter(user) else req.sales_comments,
        "rm_comments": req.rm_comments,
        "recruiter_comments": req.recruiter_comments,
        "cv_submission_date": req.cv_submission_date.isoformat() if req.cv_submission_date else None,
        "cvs_submitted_date": cvs_day.isoformat() if cvs_day else None,
        "cvs_submitted_count": cvs_count,
        "recruiter": lead,                         # the lead recruiter, who is credited when it is closed
        "recruiters": team,                        # every recruiter assigned, the lead first, each with their own CVs submitted
        "manager": {"id": req.manager_id, "username": names.get(req.manager_id) or "Former user"} if req.manager_id else None,   # the recruitment manager
        "sales_manager": {"id": req.sales_manager_id, "username": names.get(req.sales_manager_id) or "Former user"} if req.sales_manager_id else None,
        "status": req.status,
        "job_id": req.job_id,
        "closed_at": req.closed_at.isoformat() + "Z" if req.closed_at else None,
        "closed_by": req.closed_by,
        "days_to_close": _days_to_close(req),
        "created_by": req.created_by,
        "created_at": req.created_at.isoformat() + "Z",
        "updated_by": req.updated_by,
        "updated_at": req.updated_at.isoformat() + "Z",
    }


def _views(session: Session, rows: Sequence[Requirement], user: User) -> List[Dict[str, Any]]:
    """The requirements as the page shows them, with their recruiters (loaded in one go)."""
    links = _links_for(session, [r.id for r in rows])
    names = _names(session, [l.recruiter_id for ls in links.values() for l in ls] + [r.recruiter_id for r in rows]
                   + [r.manager_id for r in rows] + [r.sales_manager_id for r in rows])
    return [_view(r, names, user, links.get(r.id, [])) for r in rows]


# ----------------------------------------------------------------------------------------------------------------- history

def _short(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    text = value.isoformat() if isinstance(value, (date, datetime)) else str(value)
    return text if len(text) <= EVENT_TEXT else text[:EVENT_TEXT] + "..."


def _event(session: Session, req: Requirement, actor: User, action: str, field: Optional[str] = None, old: Any = None, new: Any = None) -> None:
    session.add(RequirementEvent(requirement_id=req.id, actor=actor.username, action=action, field=field, old_value=_short(old), new_value=_short(new)))


# ----------------------------------------------------------------------------------------------------------------- checks

def _check_recruiter(session: Session, recruiter_id: Optional[str], location: Optional[str]) -> Optional[User]:
    """The recruiter to assign, or None when there is none. ``location`` is where the caller works: a recruiter of the other location cannot
    be chosen by them. The EVP and the admin (``location`` None) may choose any recruiter."""
    if not recruiter_id:
        return None
    person = session.get(User, recruiter_id)
    if person is None or not person.is_active or person.role != "user":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose an active recruiter from the list.")
    if person.location not in LOCATIONS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="That recruiter has no location yet. Ask an administrator to set it.")
    if location is not None and person.location != location:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"That recruiter works in {person.location}, not {location}.")
    return person


def _check_manager(session: Session, manager_id: Optional[str], location: Optional[str], role: str = "manager", label: str = "recruitment manager") -> Optional[User]:
    """The recruitment manager (or sales manager) to assign, or None when there is none. Like a recruiter, one of the other location cannot be chosen by a person
    who works in one; the EVP and the admin (``location`` None) may choose any."""
    if not manager_id:
        return None
    person = session.get(User, manager_id)
    if person is None or not person.is_active or person.role != role:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Choose an active {label} from the list.")
    if person.location not in LOCATIONS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"That {label} has no location yet. Ask an administrator to set it.")
    if location is not None and person.location != location:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"That {label} works in {person.location}, not {location}.")
    return person


def _check_recruiters(session: Session, ids: Sequence[str], location: Optional[str], existing=()) -> Optional[str]:
    """Check the recruiters chosen for a requirement and give back the one location they all work in (None when there are none). A recruiter
    already on the requirement is kept as he is; each one added must be an active recruiter of the caller's location (the EVP and the admin:
    any). A requirement belongs to one team, so they must all be in the same location."""
    found = set()
    for rid in ids:
        if rid in existing:
            person = session.get(User, rid)
            if person is not None and person.location in LOCATIONS:
                found.add(person.location)
            continue
        found.add(_check_recruiter(session, rid, location).location)
    if len(found) > 1:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose recruiters from one location: a requirement belongs to one team.")
    return next(iter(found), None)


def _requested_ids(many: Optional[List[str]], one: Optional[str], sent) -> Optional[List[str]]:
    """The recruiters asked for in a request, or None when it does not mention them."""
    if "recruiter_ids" in sent:
        return list(many or [])
    if "recruiter_id" in sent:
        return [one] if one else []
    return None


def _set_assignees(session: Session, req: Requirement, ids: Sequence[str]) -> None:
    """Make these the requirement's recruiters, in this order (the first is the lead). A recruiter who stays keeps his CVs submitted."""
    current = {l.recruiter_id: l for l in session.exec(select(RequirementRecruiter).where(RequirementRecruiter.requirement_id == req.id)).all()}
    for rid, link in current.items():
        if rid not in ids:
            session.delete(link)
    for position, rid in enumerate(ids):
        link = current.get(rid)
        if link is None:
            session.add(RequirementRecruiter(requirement_id=req.id, recruiter_id=rid, position=position))
        elif link.position != position:
            link.position = position
            session.add(link)
    req.recruiter_id = ids[0] if ids else None
    session.flush()


def _jd_name(jd_id: Optional[str]) -> Optional[str]:
    if not jd_id:
        return None
    doc = get_store().jd_document(jd_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="That job description is not in the JD library.")
    return (doc.get("filename") or "Job description")[:255]


def _check_dates(requirement_date: date, cv_submission_date: Optional[date]) -> None:
    if cv_submission_date and cv_submission_date < requirement_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The CV submission date cannot be before the requirement date.")


def _check_submitted(requirement_date: date, submitted_date: Optional[date]) -> None:
    if submitted_date and submitted_date < requirement_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="CVs cannot have been submitted before the requirement date.")


# ----------------------------------------------------------------------------------------------------------------- listing

def _like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


class Filters(BaseModel):
    status: Optional[str] = None
    q: Optional[str] = None
    location: Optional[str] = None             # the EVP and the admin may look at one location; for everyone else it changes nothing
    recruiter_id: Optional[str] = None
    manager_id: Optional[str] = None            # a recruitment manager, or "none" for the requirements with nobody
    sales_manager_id: Optional[str] = None      # a sales manager, or "none"
    date_from: Optional[date] = None
    date_to: Optional[date] = None


def _filters(
    status_: Optional[str] = Query(None, alias="status", max_length=16),
    q: Optional[str] = Query(None, max_length=100),
    location: Optional[str] = Query(None, max_length=32),
    recruiter_id: Optional[str] = Query(None, max_length=36),
    manager_id: Optional[str] = Query(None, max_length=36),
    sales_manager_id: Optional[str] = Query(None, max_length=36),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> Filters:
    return Filters(status=status_, q=q, location=location, recruiter_id=recruiter_id, manager_id=manager_id, sales_manager_id=sales_manager_id, date_from=date_from, date_to=date_to)


def _assigned_to(recruiter_id: str):
    """The requirements that have this person among their recruiters."""
    return Requirement.id.in_(select(RequirementRecruiter.requirement_id).where(RequirementRecruiter.recruiter_id == recruiter_id))


def _conditions(user: User, f: Filters, with_status: bool, closed: str = "exclude") -> list:
    """The WHERE parts for what this person may see and the filters. ``closed``: "exclude" (the requirements lists: a closed requirement is on the
    Closures page), "only" (the Closures page; the dates then mean the day it was closed) or "any"."""
    conds: list = []
    own = _scope_location(user)
    if own is not None:
        conds.append(Requirement.location == own)                              # a location-bound person is held to it, whatever the address says
    elif f.location in LOCATIONS:
        conds.append(Requirement.location == f.location)                       # the EVP and the admin choosing Dubai or Abu Dhabi
    if _is_recruiter(user):
        conds.append(_assigned_to(user.id))                                    # the requirements they are one of the recruiters of
    elif f.recruiter_id == "none":
        conds.append(Requirement.recruiter_id.is_(None))                       # nobody assigned
    elif f.recruiter_id:
        conds.append(_assigned_to(f.recruiter_id))
    if f.manager_id == "none":
        conds.append(Requirement.manager_id.is_(None))
    elif f.manager_id:
        conds.append(Requirement.manager_id == f.manager_id)
    if f.sales_manager_id == "none":
        conds.append(Requirement.sales_manager_id.is_(None))
    elif f.sales_manager_id:
        conds.append(Requirement.sales_manager_id == f.sales_manager_id)
    if closed == "exclude":
        conds.append(Requirement.status != "closed")
    elif closed == "only":
        conds.append(Requirement.status == "closed")
    if with_status and closed != "only" and f.status in REQUIREMENT_STATUSES:
        conds.append(Requirement.status == f.status)
    day_column = Requirement.closed_at if closed == "only" else Requirement.requirement_date
    if f.date_from:
        conds.append(day_column >= (datetime.combine(f.date_from, datetime.min.time()) if closed == "only" else f.date_from))
    if f.date_to:
        conds.append(day_column < datetime.combine(f.date_to + timedelta(days=1), datetime.min.time()) if closed == "only" else day_column <= f.date_to)
    term = (f.q or "").replace("\x00", "").strip()
    if term:
        like = _like(term)
        parts = [Requirement.position.ilike(like, escape="\\"), Requirement.client.ilike(like, escape="\\"),
                 Requirement.job_location.ilike(like, escape="\\"),
                 Requirement.rm_comments.ilike(like, escape="\\"), Requirement.recruiter_comments.ilike(like, escape="\\"),
                 Requirement.id.in_(select(RequirementRecruiter.requirement_id).where(
                     RequirementRecruiter.recruiter_id.in_(select(User.id).where(User.username.ilike(like, escape="\\")))))]
        if not _is_recruiter(user):
            parts.append(Requirement.sales_comments.ilike(like, escape="\\"))
        conds.append(or_(*parts))
    return conds


def _order():
    return (Requirement.requirement_date.desc(), Requirement.created_at.desc())


@router.get("/options")
def options(user: User = Depends(require_core_app), session: Session = Depends(get_session)):
    """What the page needs to draw itself: the statuses, which fields this person may change, and the recruiters that can be assigned (those
    of the person's own location; the EVP and the admin get every recruiter)."""
    own = _scope_location(user) if user.role not in ALL_LOCATIONS_ROLES else None
    recruiters: List[Dict[str, Any]] = []
    managers: List[Dict[str, Any]] = []
    sales_managers: List[Dict[str, Any]] = []
    if not _is_recruiter(user):
        q = select(User).where(User.role == "user", User.is_active == True)   # noqa: E712
        if own is not None:
            q = q.where(User.location == own)
        recruiters = [{"id": u.id, "username": u.username, "location": u.location}
                      for u in session.exec(q.order_by(func.lower(User.username))).all() if u.location in LOCATIONS]
        def people(role: str) -> List[Dict[str, Any]]:
            pq = select(User).where(User.role == role, User.is_active == True)   # noqa: E712
            if own is not None:
                pq = pq.where(User.location == own)
            return [{"id": u.id, "username": u.username, "location": u.location}
                    for u in session.exec(pq.order_by(func.lower(User.username))).all() if u.location in LOCATIONS]
        managers, sales_managers = people("manager"), people("account_manager")
    return {
        "statuses": list(REQUIREMENT_STATUSES),
        "locations": list(LOCATIONS),
        "all_locations": own is None,              # the EVP and the admin get a Location dropdown: everyone else is in one location
        "can_create": user.role in TRACKER_FULL_ROLES,
        # which fields this person may change (the page shows the others as plain text)
        "editable": {k: user.role in v for k, v in REQUIREMENT_FIELD_EDITORS.items()},
        "recruiters": recruiters,
        "managers": managers,                      # the recruitment managers a requirement can be assigned to
        "sales_managers": sales_managers,          # and the sales managers
    }


@router.get("/requirements")
def list_requirements(
    f: Filters = Depends(_filters),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0, le=100000),
    user: User = Depends(require_core_app),
    session: Session = Depends(get_session),
):
    conds = _conditions(user, f, with_status=True)
    total = session.exec(select(func.count()).select_from(Requirement).where(*conds)).one()
    rows = session.exec(select(Requirement).where(*conds).order_by(*_order()).offset(offset).limit(limit)).all()
    # the tiles count what the filters match, whatever the status filter says, so they can be used to switch between statuses
    by_status = dict(session.exec(select(Requirement.status, func.count()).where(*_conditions(user, f, with_status=False, closed="any")).group_by(Requirement.status)).all())
    stats = {s: int(by_status.get(s, 0)) for s in REQUIREMENT_STATUSES}
    stats["total"] = sum(stats.values())
    # the CVs submitted across every requirement these filters match (closed and canceled ones too), as the other tiles count them
    cvs = (select(func.coalesce(func.sum(RequirementRecruiter.cvs_submitted_count), 0)).select_from(RequirementRecruiter)
           .join(Requirement, Requirement.id == RequirementRecruiter.requirement_id).where(*_conditions(user, f, with_status=False, closed="any")))
    if _is_recruiter(user):
        cvs = cvs.where(RequirementRecruiter.recruiter_id == user.id)           # a recruiter's total is what they submitted themselves
    stats["cvs_submitted"] = int(session.exec(cvs).one() or 0)
    return {"items": _views(session, rows, user), "total": int(total), "stats": stats}


# ----------------------------------------------------------------------------------------------------------------- excel

def _xlsx(sheet: str, columns: List[tuple], data: List[List[Any]], *, tint_column: Optional[str] = None, tints: Optional[Dict[str, str]] = None) -> bytes:
    """A styled worksheet: a brand header row, real dates, wrapped comments, text that is never run as a formula, frozen header and filter."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    head_fill = PatternFill("solid", fgColor="1E4398")
    thin = Side(style="thin", color="D9DEE7")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for i, (title, width) in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=i, value=title)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = head_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.row_dimensions[1].height = 30
    for row, values in enumerate(data, start=2):
        for col, value in enumerate(values, start=1):
            title = columns[col - 1][0]
            cell = ws.cell(row=row, column=col)
            if isinstance(value, str):
                cell.value = value
                cell.data_type = "s"            # text, never a formula, even if it starts with = + - @
            else:
                cell.value = value
            if isinstance(value, datetime):
                cell.number_format = "dd-mmm-yyyy hh:mm"
            elif isinstance(value, date):
                cell.number_format = "dd-mmm-yyyy"
            cell.alignment = Alignment(vertical="top", wrap_text="comments" in title or title in ("Position", "Client", "Job location"),
                                       horizontal="center" if title in ("S.No", "Status", "Posted in Careers", "Days to close") else None)
            cell.border = border
            if tint_column and title == tint_column and tints:
                cell.fill = PatternFill("solid", fgColor=tints.get(str(value).lower(), "FFFFFF"))
                cell.font = Font(bold=True)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{max(len(data) + 1, 2)}"
    ws.sheet_view.showGridLines = False
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _workbook(rows: List[Requirement], names: Dict[str, str], user: User, links: Dict[str, List[RequirementRecruiter]]) -> bytes:
    recruiter_view = _is_recruiter(user)
    # the columns are the page's, in its order (a recruiter's page has no Recruiter column and no sales manager comments)
    columns = [("S.No", 7), ("Position", 34), ("Client", 26)]
    if not recruiter_view:
        columns.append(("Recruiter", 18))
    columns += [("Recruitment manager", 20), ("Sales manager", 18), ("Requirement date", 16), ("Submission deadline", 20), ("CVs submitted on", 18),
                ("No. of CVs submitted", 14), ("Status", 12)]
    if not recruiter_view:
        columns.append(("Sales manager comments", 40))
    columns += [("Recruitment manager comments", 40), ("Recruiter comments", 40), ("Job location", 22), ("Salary", 18), ("Job duration", 22), ("Posted in Careers", 16)]
    data: List[List[Any]] = []
    for n, r in enumerate(rows, start=1):
        values: List[Any] = [n, r.position, r.client]
        if not recruiter_view:
            values.append(_recruiters_text(r, links.get(r.id, []), names))
        values += [_who(names, r.manager_id), _who(names, r.sales_manager_id), r.requirement_date, r.cv_submission_date,
                   *_cvs_summary(links.get(r.id, []), user), r.status.capitalize()]
        if not recruiter_view:
            values.append(r.sales_comments or "")
        values += [r.rm_comments or "", r.recruiter_comments or "", r.job_location or "", r.salary or "",
                   _duration_text(r.duration_type, r.duration_value, r.duration_unit, r.duration_extendable) or "", "Yes" if r.job_id else "No"]
        data.append(values)
    return _xlsx("Requirements", columns, data, tint_column="Status",
                 tints={"open": "DCEBFF", "submitted": "DDF5E4", "hold": "FFF1CC", "closed": "E7E9EE", "canceled": "FBDADA"})


@router.get("/requirements/export")
def export_requirements(f: Filters = Depends(_filters), user: User = Depends(require_core_app), session: Session = Depends(get_session)):
    """The requirements the filters match (the same list the page shows, without paging), as an Excel file."""
    rows = session.exec(select(Requirement).where(*_conditions(user, f, with_status=True)).order_by(*_order()).limit(MAX_EXPORT_ROWS)).all()   # not the closed ones
    links = _links_for(session, [r.id for r in rows])
    names = _names(session, [l.recruiter_id for ls in links.values() for l in ls] + [r.manager_id for r in rows] + [r.sales_manager_id for r in rows])
    data = _workbook(list(rows), names, user, links)
    security_event("requirements_exported", by=user.username, rows=len(rows))
    name = f"requirements-{date.today().isoformat()}.xlsx"
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


# ----------------------------------------------------------------------------------------------------------------- one requirement

@router.post("/requirements", status_code=201)
def create_requirement(body: RequirementIn, user: User = Depends(require_core_app), session: Session = Depends(get_session)):
    _require_full(user, "add a requirement")
    sent = body.model_fields_set
    _check_editable(user, [f for f in sent
                           if f in ("jd_id", "recruiter_id", "recruiter_ids", "manager_id", "sales_manager_id", "sales_comments", "rm_comments", "recruiter_comments", "cv_submission_date", "status")
                           and getattr(body, f) is not None and not (f == "status" and body.status == "open")])
    own = _scope_location(user)                          # the person's own location; None for the EVP and the admin
    _check_dates(body.requirement_date, body.cv_submission_date)
    ids = _requested_ids(body.recruiter_ids, body.recruiter_id, sent) or []
    common = _check_recruiters(session, ids, own)
    manager = _check_manager(session, body.manager_id, own)
    # the sales manager is the one who adds it, unless another is chosen (the EVP, the admin and the recruitment manager choose)
    sales_id = body.sales_manager_id if "sales_manager_id" in sent else (user.id if user.role == "account_manager" else None)
    sales = _check_manager(session, sales_id, own, "account_manager", "sales manager")
    # nobody types the location: it is the creator's, or (EVP and admin) the assigned people's, and empty until one is assigned
    location = own or common or (manager.location if manager else None) or (sales.location if sales else None)
    for person, label in ((manager, "recruitment manager"), (sales, "sales manager")):
        if person and location and person.location != location:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=f"The {label} works in {person.location}, the rest of the team in {location}: a requirement belongs to one team.")
    req = Requirement(
        location=location, requirement_date=body.requirement_date, position=body.position, client=body.client,
        job_location=body.job_location, salary=body.salary, jd_id=body.jd_id,
        duration_type=body.duration_type, duration_value=body.duration_value, duration_unit=body.duration_unit,
        duration_extendable=body.duration_extendable, jd_filename=_jd_name(body.jd_id), sales_comments=body.sales_comments, rm_comments=body.rm_comments,
        recruiter_comments=body.recruiter_comments, cv_submission_date=body.cv_submission_date,
        manager_id=manager.id if manager else None, sales_manager_id=sales.id if sales else None,
        status=body.status, created_by=user.username, updated_by=user.username,
        closed_at=datetime.utcnow() if body.status == "closed" else None, closed_by=user.username if body.status == "closed" else None,
    )
    session.add(req)
    session.flush()
    _set_assignees(session, req, ids)
    _event(session, req, user, "created")
    if req.status == "closed":
        create_for_closed(session, req, ids)                     # a requirement added already closed is on the Selections page too
    session.commit()
    session.refresh(req)
    security_event("requirement_created", by=user.username, requirement=req.id, location=location)
    return _views(session, [req], user)[0]


@router.get("/requirements/{requirement_id}")
def get_requirement(requirement_id: str, user: User = Depends(require_core_app), session: Session = Depends(get_session)):
    req = _get_visible(session, user, requirement_id)
    events = session.exec(select(RequirementEvent).where(RequirementEvent.requirement_id == req.id).order_by(RequirementEvent.at.desc())).all()
    if _is_recruiter(user):
        events = [e for e in events if e.field != "sales_comments"]
    view = _views(session, [req], user)[0]
    view["history"] = [{"at": e.at.isoformat() + "Z", "actor": e.actor, "action": e.action, "field": e.field, "old": e.old_value, "new": e.new_value} for e in events]
    return view


def _tag(who: str, value: Any) -> Optional[str]:
    """A recruiter's CVs submitted as the history writes it: "rita: 3"."""
    if value is None:
        return None
    return f"{who}: {value.isoformat() if isinstance(value, date) else value}"


@router.patch("/requirements/{requirement_id}")
def update_requirement(requirement_id: str, body: RequirementPatch, user: User = Depends(require_core_app), session: Session = Depends(get_session)):
    req = _get_visible(session, user, requirement_id, lock=True)
    sent = set(body.model_fields_set)
    _check_editable(user, sent)
    for required in ("requirement_date", "position", "client", "status"):
        if required in sent and getattr(body, required) is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{required.replace('_', ' ').capitalize()} cannot be empty.")

    new_date = body.requirement_date if "requirement_date" in sent else req.requirement_date
    new_cv = body.cv_submission_date if "cv_submission_date" in sent else req.cv_submission_date
    new_status = body.status if "status" in sent and body.status else req.status
    current_ids = _assignee_ids(session, req.id)
    requested = _requested_ids(body.recruiter_ids, body.recruiter_id, sent)
    new_ids = current_ids if requested is None else requested
    if new_status == "closed" and set(new_ids) != set(current_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A closed requirement stays with its recruiters. Reopen it to change them.")
    _check_dates(new_date, new_cv)
    common_location = _check_recruiters(session, new_ids, _scope_location(user), existing=set(current_ids)) if requested is not None else None

    # what each recruiter submitted: a recruiter changes only their own; the recruiter has to be one of this requirement's
    submissions = []
    for item in (body.cvs_submissions or []) if "cvs_submissions" in sent else []:
        if item.recruiter_id not in new_ids:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="That recruiter is not assigned to this requirement.")
        if _is_recruiter(user) and item.recruiter_id != user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only change your own CVs submitted.")
        if "date" in item.model_fields_set:
            _check_submitted(new_date, item.date)
        submissions.append(item)

    # the duration is four fields that make one: what is not sent keeps its value, and the result must still make sense
    duration_now = (req.duration_type, req.duration_value, req.duration_unit, req.duration_extendable)
    duration_new = duration_now
    if sent & {"duration_type", "duration_value", "duration_unit", "duration_extendable"}:
        merged = [getattr(body, name) if name in sent else old for name, old in
                  zip(("duration_type", "duration_value", "duration_unit", "duration_extendable"), duration_now)]
        try:
            duration_new = _duration(*merged)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    # the recruitment manager and the sales manager: a new one must be an active person of that role in the caller's location, and of the
    # team the requirement belongs to
    final_location = common_location or req.location
    moving = bool(common_location and common_location != req.location)         # the EVP or the admin hands it to the other location's recruiters
    team: Dict[str, tuple] = {}
    for field, role, label in (("manager_id", "manager", "recruitment manager"), ("sales_manager_id", "account_manager", "sales manager")):
        chosen = field in sent
        new_id = getattr(body, field) if chosen else getattr(req, field)
        person = session.get(User, new_id) if new_id else None
        if chosen and new_id and new_id != getattr(req, field):
            person = _check_manager(session, new_id, _scope_location(user), role, label)
        if person is not None and (chosen or moving):
            if final_location and person.location != final_location:
                if chosen:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                        detail=f"The {label} works in {person.location}, the requirement belongs to {final_location}.")
                person, new_id, chosen = None, None, True          # handed to the other team: it leaves the old team's manager behind
            else:
                final_location = final_location or person.location
        team[field] = (chosen, new_id, label.replace(" ", "_"))

    names = _names(session, current_ids + new_ids + [req.manager_id, req.sales_manager_id] + [t[1] for t in team.values()])
    old_status = req.status
    changes: List[tuple] = []
    deactivate: Optional[str] = None            # the job posted from a description that was just replaced or removed
    for field in ("requirement_date", "position", "client", "job_location", "salary", "sales_comments", "rm_comments", "recruiter_comments",
                  "cv_submission_date", "status"):
        if field in sent:
            old, new = getattr(req, field), getattr(body, field)
            if old != new:
                setattr(req, field, new)
                changes.append((field, old, new))
    for field, (chosen, new_id, event_name) in team.items():
        old_id = getattr(req, field)
        if chosen and new_id != old_id:
            changes.append((event_name, (names.get(old_id) or "Former user") if old_id else None, (names.get(new_id) or "Former user") if new_id else None))
            setattr(req, field, new_id)
    if final_location and not req.location and not common_location:                  # the EVP or the admin chose the first person: it joins their team
        changes.append(("location", req.location, final_location))
        req.location = final_location
    if requested is not None and new_ids != current_ids:
        join = lambda ids: ", ".join(names.get(i) or "Former user" for i in ids) or None
        changes.append(("recruiter", join(current_ids), join(new_ids)))
        _set_assignees(session, req, new_ids)
        if common_location and common_location != req.location:      # the EVP or the admin chose recruiters of the other team (or the first ones)
            changes.append(("location", req.location, common_location))
            req.location = common_location
    if old_status != "closed" and new_status == "closed":
        req.closed_at, req.closed_by = datetime.utcnow(), user.username           # it now leaves the requirements lists for Closures
        if _is_recruiter(user) and new_ids and user.id in new_ids and new_ids[0] != user.id:
            _set_assignees(session, req, [user.id] + [i for i in new_ids if i != user.id])    # the recruiter who closed it is the one credited
        create_for_closed(session, req, _assignee_ids(session, req.id))           # and it gets its row on the Selections and joining page
    elif old_status == "closed" and new_status != "closed":
        req.closed_at, req.closed_by = None, None                                  # reopened
    if submissions:
        links = {l.recruiter_id: l for l in session.exec(select(RequirementRecruiter).where(RequirementRecruiter.requirement_id == req.id)).all()}
        for item in submissions:
            link, who = links[item.recruiter_id], names.get(item.recruiter_id) or "Former user"
            if "date" in item.model_fields_set and link.cvs_submitted_date != item.date:
                changes.append(("cvs_submitted_date", _tag(who, link.cvs_submitted_date), _tag(who, item.date)))
                link.cvs_submitted_date = item.date
            if "count" in item.model_fields_set and link.cvs_submitted_count != item.count:
                changes.append(("cvs_submitted_count", _tag(who, link.cvs_submitted_count), _tag(who, item.count)))
                link.cvs_submitted_count = item.count
            session.add(link)
    if "jd_id" in sent and req.jd_id != body.jd_id:
        old_name, old_job = req.jd_filename, req.job_id
        req.jd_id, req.jd_filename = body.jd_id, _jd_name(body.jd_id)
        req.job_id = None                       # the new job description has not been posted yet
        changes.append(("jd", old_name, req.jd_filename))
        if old_job:
            changes.append(("job_posted", old_job, None))
            deactivate = old_job                # it is switched off, not deleted

    if duration_new != duration_now:
        req.duration_type, req.duration_value, req.duration_unit, req.duration_extendable = duration_new
        changes.append(("duration", _duration_text(*duration_now), _duration_text(*duration_new)))

    if changes:
        req.updated_by, req.updated_at = user.username, datetime.utcnow()
        session.add(req)
        for field, old, new in changes:
            _event(session, req, user, "changed", field, old, new)
        session.commit()
        session.refresh(req)
        security_event("requirement_updated", by=user.username, requirement=req.id, fields=",".join(c[0] for c in changes))
        if deactivate:
            _deactivate_replaced_job(deactivate, user.username)
    return _views(session, [req], user)[0]


@router.post("/requirements/{requirement_id}/posted")
def mark_posted(requirement_id: str, body: PostedIn, user: User = Depends(require_core_app), session: Session = Depends(get_session)):
    """The recruiter has posted this requirement's job in Careers: remember which job it is. Posting itself happens in Careers."""
    req = _get_visible(session, user, requirement_id)
    job = get_store().get_job_posting_by_id(body.job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That job is not in Careers.")
    if user.role != "admin" and job.get("posted_by_user") != user.username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="That job was posted by someone else.")
    if req.job_id != body.job_id:
        _event(session, req, user, "changed", "job_posted", req.job_id, body.job_id)
        req.job_id, req.updated_by, req.updated_at = body.job_id, user.username, datetime.utcnow()
        session.add(req)
        session.commit()
        session.refresh(req)
    return _views(session, [req], user)[0]


@router.delete("/requirements/{requirement_id}", status_code=204)
def delete_requirement(requirement_id: str, user: User = Depends(require_core_app), session: Session = Depends(get_session)):
    _require_full(user, "delete a requirement")
    req = _get_visible(session, user, requirement_id, lock=True)
    session.execute(RequirementEvent.__table__.delete().where(RequirementEvent.__table__.c.requirement_id == req.id))
    session.execute(RequirementRecruiter.__table__.delete().where(RequirementRecruiter.__table__.c.requirement_id == req.id))
    session.delete(req)
    session.commit()
    security_event("requirement_deleted", by=user.username, requirement=requirement_id)
    return Response(status_code=204)
