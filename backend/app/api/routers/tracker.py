from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import and_ as and_c, or_ as or_c
from sqlmodel import Session, select

from app.config.settings import settings
from app.db.database import get_session as get_tracker_session
from app.api.deps import require_roles
from app.models.tracker.models import (
    TrackerApplication,
    TrackerCandidate,
    TrackerFollowUp,
    TrackerJobOpening,
    TrackerOption,
)
from app.models.user import User
from app.schemas.tracker import (
    TrackerApplicationCreate,
    TrackerApplicationRead,
    TrackerApplicationUpdate,
    TrackerCandidateCreate,
    TrackerCandidateRead,
    TrackerCandidateRowRead,
    TrackerCandidateUpdate,
    TrackerFollowUpCreate,
    TrackerFollowUpRead,
    TrackerFollowUpUpdate,
    TrackerJobOpeningCreate,
    TrackerJobOpeningRead,
    TrackerJobOpeningUpdate,
    TrackerOptionCreate,
    TrackerOptionRead,
    TrackerOptionUpdate,
)
from app.providers.cache.redis import get_redis_cache
from app.config.settings import is_followup_email_reminder_enabled
from app.integrations.email.followup_reminder_service import (join_emails as _join_emails, render_followup_email_html, send_followup_reminder_email,
                                                               split_emails as _split_emails)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tracker", tags=["Candidate Tracker"])

_TRACKER_CACHE_NAMESPACE = "tracker"


def _tracker_cache_key(team: str, name: str, *parts: str) -> str:
    safe_parts = [p.replace(" ", "").replace("\n", "") for p in parts if p is not None]
    return "|".join([team, name, *safe_parts])


def _tracker_cache_get(team: str, name: str, *parts: str):
    try:
        return get_redis_cache().get(_tracker_cache_key(team, name, *parts), namespace=_TRACKER_CACHE_NAMESPACE)
    except Exception:
        return None


def _tracker_cache_set(team: str, name: str, value, ttl_seconds: int, *parts: str) -> None:
    try:
        get_redis_cache().set(
            _tracker_cache_key(team, name, *parts),
            value,
            ttl_seconds=ttl_seconds,
            namespace=_TRACKER_CACHE_NAMESPACE,
        )
    except Exception:
        return None


def _tracker_cache_bust() -> None:
    # Keep invalidation simple and safe: any write clears tracker cache only.
    try:
        get_redis_cache().clear_namespace(_TRACKER_CACHE_NAMESPACE)
    except Exception:
        return None


def tracker_session(session: Session = Depends(get_tracker_session)) -> Session:
    # IMPORTANT: this dependency runs before route handlers. Keep the feature flag and
    # database checks here so disabled tracker endpoints don't crash due to missing DB.
    _require_tracker_enabled()
    return session


def _require_tracker_enabled():
    if not settings.ENABLE_CANDIDATE_TRACKER:
        raise HTTPException(status_code=404, detail="Candidate Tracker is disabled")


def _touch_updated_at(obj):
    if hasattr(obj, "updated_at"):
        obj.updated_at = datetime.utcnow()


# EVP has manager-level access across the app.
# account_manager is a tracker-only role: it has NO access to the other ATS pages,
# but FULL read AND write access to the Candidate Tracker (manager-level within the tracker).
AllowedTrackerReadUser = Depends(require_roles("admin", "manager", "evp", "user", "recruiter", "account_manager"))
# Write access: managers/admins, plus account_manager (full tracker write). Recruiters/users stay read-only.
AllowedTrackerWriteUser = Depends(require_roles("manager", "account_manager"))
# Follow-ups: recruiters/users/account managers are allowed to create/update/delete.
AllowedTrackerFollowUpWriteUser = Depends(require_roles("admin", "manager", "evp", "user", "recruiter", "account_manager"))
AllowedTrackerJobWriteUser = Depends(require_roles("manager", "account_manager"))
AllowedTrackerOptionWriteUser = Depends(require_roles("manager", "account_manager"))
AllowedTrackerAdminUser = Depends(require_roles("admin"))
AllowedTrackerManagerUser = Depends(require_roles("manager", "account_manager"))

_RECRUITER_ROLES = frozenset({"recruiter", "user"})


def _norm_team(v: str) -> str:
    return "".join(ch for ch in (v or "").strip().lower() if ch.isalnum())


def _resolve_tracker_team(user: User, team: Optional[str]) -> str:
    """
    Resolve which tracker table set to use.

    - Non-admin/EVP: forced by user.team_location.
    - Admin/EVP: can override via ?team=dubai|abudhabi.
    """
    is_admin_like = user.role in {"admin", "evp"}
    if is_admin_like and team:
        t = _norm_team(team)
        if t in {"dubai", "dxb"}:
            return "dubai"
        if t in {"abudhabi", "abudabi", "abudh"}:
            return "abudhabi"
        raise HTTPException(status_code=400, detail="Invalid team; use dubai|abudhabi")

    tl = _norm_team(getattr(user, "team_location", None) or "")
    if tl in {"abudhabi", "abudabi", "abudh"}:
        return "abudhabi"
    # default to dubai to preserve existing behavior/data
    return "dubai"


def _scoped_team(session: Session, user: User, team: Optional[str]) -> str:
    """The team this request works for; the session is limited to it from here on (see app/models/tracker/scope.py)."""
    from app.models.tracker.scope import scope_session

    return scope_session(session, _resolve_tracker_team(user, team))


def _tracker_models(team: str):
    """The tracker tables (the same for both teams: rows carry their team, and the scoped session keeps each request to its own)."""
    return {
        "JobOpening": TrackerJobOpening,
        "Candidate": TrackerCandidate,
        "Application": TrackerApplication,
        "FollowUp": TrackerFollowUp,
        "Option": TrackerOption,
    }


def _reject_job_status_option_for_candidate_roles(user: User, kind: str | None) -> None:
    """Recruiters (`user` | `recruiter`) must not edit requirement (job) status picklists."""
    if kind == "job_status" and user.role in _RECRUITER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to modify requirement status options",
        )


@router.post("/admin/import/selections-xlsx", status_code=200)
async def import_selections_xlsx(
    team: str = Query(..., description="dubai|abudhabi"),
    file: UploadFile = File(...),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerAdminUser,
):
    """
    Admin import for Selections & Joinings from the exported candidates.xlsx format.

    - Imports into the selected team's tables (Dubai or Abu Dhabi).
    - Does not touch Manager Settings/options; you can manage those manually.
    """
    from datetime import date
    from io import BytesIO

    from openpyxl import load_workbook

    team_norm = _norm_team(team)
    if team_norm not in {"dubai", "dxb", "abudhabi", "abudabi", "abudh"}:
        raise HTTPException(status_code=400, detail="Invalid team; use dubai|abudhabi")
    team_resolved = "abudhabi" if team_norm in {"abudhabi", "abudabi", "abudh"} else "dubai"
    from app.models.tracker.scope import scope_session

    scope_session(session, team_resolved)
    models = _tracker_models(team_resolved)
    Candidate = models["Candidate"]
    Application = models["Application"]

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        wb = load_workbook(filename=BytesIO(raw), data_only=True)
        ws = wb.active
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Excel file")

    # Expect the same header as export_candidates_xlsx
    header_row = [str(c.value).strip() if c.value is not None else "" for c in next(ws.iter_rows(min_row=1, max_row=1))]
    header_map = {h.lower(): i for i, h in enumerate(header_row)}
    required = ["candidate name"]
    for r in required:
        if r not in header_map:
            raise HTTPException(status_code=400, detail=f"Missing required column: {r}")

    def _cell(row, name: str) -> str:
        idx = header_map.get(name.lower())
        if idx is None:
            return ""
        v = row[idx].value
        return (str(v).strip() if v is not None else "")

    def _parse_date(v: str | None) -> date | None:
        if not v:
            return None
        try:
            # If openpyxl already gave us a python date/datetime, keep it.
            if hasattr(v, "year") and hasattr(v, "month") and hasattr(v, "day"):
                return date(int(v.year), int(v.month), int(v.day))  # type: ignore[arg-type]
            s = str(v).strip()
            if not s:
                return None
            return date.fromisoformat(s[:10])
        except Exception:
            return None

    inserted_candidates = 0
    inserted_applications = 0
    skipped = 0

    for row in ws.iter_rows(min_row=2):
        name = _cell(row, "Candidate Name")
        if not name:
            skipped += 1
            continue

        cand = session.exec(
            select(Candidate).where(Candidate.name == name).where(Candidate.is_deleted == False)  # noqa: E712
        ).first()
        if not cand:
            cand = Candidate(name=name)
            session.add(cand)
            session.commit()
            session.refresh(cand)
            inserted_candidates += 1

        applied_date = _parse_date(_cell(row, "Date"))
        app = Application(
            candidate_id=cand.id,
            job_opening_id=None,
            applied_date=applied_date,
            position=_cell(row, "Position") or None,
            client=_cell(row, "Client") or None,
            status=_cell(row, "Status") or "MRF Pending",
            recruiter=_cell(row, "Recruiter") or None,
            account_manager=_cell(row, "Account Manager") or None,
            recruitment_manager=_cell(row, "Recruitment Manager") or None,
            comment=_cell(row, "Comment") or None,
            created_by_username=getattr(user, "username", None),
            created_by_role=getattr(user, "role", None),
            created_by_team_location=("Abu Dhabi" if team_resolved == "abudhabi" else "Dubai"),
        )
        session.add(app)
        session.commit()
        inserted_applications += 1

    _tracker_cache_bust()
    return {
        "success": True,
        "team": team_resolved,
        "inserted_candidates": inserted_candidates,
        "inserted_applications": inserted_applications,
        "skipped_rows": skipped,
    }


@router.post("/admin/clear-team", status_code=200)
def clear_tracker_team_data(
    team: str = Query(..., description="dubai|abudhabi"),
    confirm: str = Query(..., description="must be CLEAR to proceed"),
    session: Session = Depends(tracker_session),
    _: User = AllowedTrackerAdminUser,
):
    """
    Admin-only bulk clear for a team's tracker tables.

    This is intended for the migration path where you import old data into Abu Dhabi
    and then want to clear the Dubai dataset without touching Abu Dhabi (or vice versa).
    """
    from sqlalchemy import text

    if confirm.strip().upper() != "CLEAR":
        raise HTTPException(status_code=400, detail="Missing confirm=CLEAR")

    team_norm = _norm_team(team)
    if team_norm not in {"dubai", "dxb", "abudhabi", "abudabi", "abudh"}:
        raise HTTPException(status_code=400, detail="Invalid team; use dubai|abudhabi")

    is_ad = team_norm in {"abudhabi", "abudabi", "abudh"}

    # IMPORTANT: delete order matters due to foreign keys. Only this team's rows go; the other team is not touched.
    tables = ["tracker_application", "tracker_candidate", "tracker_job_opening", "tracker_follow_up", "tracker_option"]

    bind = session.get_bind()
    deleted: dict[str, int] = {}
    with bind.begin() as conn:
        for t in tables:
            # `t` comes from the fixed list above, never from the request; the team value is a bound parameter.
            res = conn.execute(text(f'DELETE FROM "{t}" WHERE team = :team'),  # nosec B608
                                {"team": "abudhabi" if is_ad else "dubai"})
            deleted[t] = int(getattr(res, "rowcount", 0) or 0)

    _tracker_cache_bust()
    return {"success": True, "team": ("abudhabi" if is_ad else "dubai"), "deleted": deleted}


@router.get("/job-openings", response_model=List[TrackerJobOpeningRead])
def list_job_openings(
    status_filter: Optional[str] = None,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    team_resolved = _scoped_team(session, user, team)
    cache_hit = _tracker_cache_get(
        team_resolved,
        "job_openings",
        f"status={status_filter or ''}",
    )
    if cache_hit is not None:
        return cache_hit
    JobOpening = _tracker_models(team_resolved)["JobOpening"]
    q = select(JobOpening).where(JobOpening.is_deleted == False)  # noqa: E712
    if status_filter:
        q = q.where(JobOpening.status == status_filter)
    rows = session.exec(q.order_by(JobOpening.created_at.desc())).all()
    out = [
        TrackerJobOpeningRead(
            id=r.id,
            title=r.title,
            department=r.department,
            client=getattr(r, "client", None),
            status=r.status,
            hiring_manager=r.hiring_manager,
            recruitment_manager=getattr(r, "recruitment_manager", None),
            req_date=r.req_date,
            submission_date=getattr(r, "submission_date", None),
            cvs_submitted_count=getattr(r, "cvs_submitted_count", None),
            comments=getattr(r, "comments", None),
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]
    _tracker_cache_set(team_resolved, "job_openings", [o.model_dump() for o in out], 60, f"status={status_filter or ''}")
    return out


@router.post("/job-openings", response_model=TrackerJobOpeningRead, status_code=201)
def create_job_opening(
    data: TrackerJobOpeningCreate,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerJobWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    JobOpening = _tracker_models(team_resolved)["JobOpening"]
    row = JobOpening(
        title=data.title,
        department=data.department,
        client=getattr(data, "client", None),
        status=data.status,
        hiring_manager=data.hiring_manager,
        recruitment_manager=getattr(data, "recruitment_manager", None),
        req_date=data.req_date,
        submission_date=getattr(data, "submission_date", None),
        cvs_submitted_count=getattr(data, "cvs_submitted_count", None),
        comments=getattr(data, "comments", None),
    )
    session.add(row)
    
    # Auto-create follow-up if submission_date is provided on creation
    if getattr(data, "submission_date", None):
        FollowUp = _tracker_models(team_resolved)["FollowUp"]
        from datetime import timedelta
        next_date = data.submission_date + timedelta(days=1)
        new_fu = FollowUp(
            client_name=row.client or "Unknown",
            position=row.title,
            recruiter_name=row.hiring_manager,
            account_manager=row.department, # department is used for Account Manager in UI
            recruitment_manager=row.recruitment_manager,
            cv_submitted_date=data.submission_date,
            current_stage="Feedback Pending",
            last_follow_up_date=next_date,
            follow_up_date=next_date,
            next_follow_up_date=next_date,
        )
        session.add(new_fu)

    session.commit()
    session.refresh(row)
    _tracker_cache_bust()
    return TrackerJobOpeningRead(
        id=row.id,
        title=row.title,
        department=row.department,
        client=getattr(row, "client", None),
        status=row.status,
        hiring_manager=row.hiring_manager,
        recruitment_manager=getattr(row, "recruitment_manager", None),
        req_date=row.req_date,
        submission_date=getattr(row, "submission_date", None),
        cvs_submitted_count=getattr(row, "cvs_submitted_count", None),
        comments=getattr(row, "comments", None),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.patch("/job-openings/{job_opening_id}", response_model=TrackerJobOpeningRead)
def update_job_opening(
    job_opening_id: str,
    data: TrackerJobOpeningUpdate,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerJobWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    JobOpening = _tracker_models(team_resolved)["JobOpening"]
    row = session.exec(select(JobOpening).where(JobOpening.id == job_opening_id)).first()
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Job opening not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    
    # Auto-create follow-up if submission_date is set or updated
    if data.submission_date:
        FollowUp = _tracker_models(team_resolved)["FollowUp"]
        # Check if follow-up already exists for this job opening (using position and client as proxy)
        existing_fu = session.exec(
            select(FollowUp)
            .where(FollowUp.position == row.title)
            .where(FollowUp.client_name == (row.client or ""))
            .where(FollowUp.is_deleted == False)
        ).first()
        
        if not existing_fu:
            from datetime import timedelta
            next_date = data.submission_date + timedelta(days=1)
            new_fu = FollowUp(
                client_name=row.client or "Unknown",
                position=row.title,
                recruiter_name=row.hiring_manager,
                account_manager=row.department, # department is used for Account Manager in UI
                recruitment_manager=row.recruitment_manager,
                cv_submitted_date=data.submission_date,
                current_stage="Feedback Pending",
                last_follow_up_date=next_date,
                follow_up_date=next_date,
                next_follow_up_date=next_date,
            )
            session.add(new_fu)

    _touch_updated_at(row)
    session.add(row)
    session.commit()
    session.refresh(row)
    _tracker_cache_bust()
    return TrackerJobOpeningRead(
        id=row.id,
        title=row.title,
        department=row.department,
        client=getattr(row, "client", None),
        status=row.status,
        hiring_manager=row.hiring_manager,
        recruitment_manager=getattr(row, "recruitment_manager", None),
        req_date=row.req_date,
        submission_date=getattr(row, "submission_date", None),
        cvs_submitted_count=getattr(row, "cvs_submitted_count", None),
        comments=getattr(row, "comments", None),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/options", response_model=List[TrackerOptionRead])
def list_options(
    kind: str,
    include_deleted: bool = False,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    team_resolved = _scoped_team(session, user, team)
    cache_hit = _tracker_cache_get(
        team_resolved,
        "options",
        f"kind={kind}",
        f"include_deleted={include_deleted}",
    )
    if cache_hit is not None:
        return cache_hit
    Option = _tracker_models(team_resolved)["Option"]
    q = select(Option).where(Option.kind == kind)
    if not include_deleted:
        q = q.where(Option.is_deleted == False)  # noqa: E712
    rows = session.exec(q.order_by(Option.value.asc())).all()
    out = [
        TrackerOptionRead(
            id=r.id,
            kind=r.kind,
            value=r.value,
            email=getattr(r, "email", None),
            email_enabled=bool(getattr(r, "email_enabled", True)),
            is_deleted=r.is_deleted,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]
    _tracker_cache_set(
        team_resolved,
        "options",
        [o.model_dump() for o in out],
        120,
        f"kind={kind}",
        f"include_deleted={include_deleted}",
    )
    return out


@router.post("/options", response_model=TrackerOptionRead, status_code=201)
def create_option(
    data: TrackerOptionCreate,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerOptionWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    Option = _tracker_models(team_resolved)["Option"]
    kind = data.kind.strip()
    _reject_job_status_option_for_candidate_roles(user, kind)
    value = data.value.strip()
    if not kind or not value:
        raise HTTPException(status_code=400, detail="kind and value are required")

    existing = session.exec(
        select(Option).where(Option.kind == kind).where(Option.value == value).where(Option.is_deleted == False)  # noqa: E712
    ).first()
    if existing:
        return TrackerOptionRead(
            id=existing.id,
            kind=existing.kind,
            value=existing.value,
            email=getattr(existing, "email", None),
            email_enabled=bool(getattr(existing, "email_enabled", True)),
            is_deleted=existing.is_deleted,
            created_at=existing.created_at,
            updated_at=existing.updated_at,
        )

    row = Option(
        kind=kind,
        value=value,
        email=(data.email.strip() if isinstance(getattr(data, "email", None), str) and data.email.strip() else None),
        email_enabled=bool(getattr(data, "email_enabled", True)),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    _tracker_cache_bust()
    return TrackerOptionRead(
        id=row.id,
        kind=row.kind,
        value=row.value,
        email=getattr(row, "email", None),
        email_enabled=bool(getattr(row, "email_enabled", True)),
        is_deleted=row.is_deleted,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.delete("/options/purge-inactive", status_code=200)
def purge_inactive_options(
    kind: str,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerOptionWriteUser,
):
    """Hard-delete inactive (is_deleted=true) options for a kind.

    This only affects tracker_option rows and never deletes any requirement/joinings/follow-ups records.
    """
    if not kind or not kind.strip():
        raise HTTPException(status_code=400, detail="kind is required")
    kind = kind.strip()
    team_resolved = _scoped_team(session, user, team)
    Option = _tracker_models(team_resolved)["Option"]
    rows = session.exec(
        select(Option).where(Option.kind == kind).where(Option.is_deleted == True)  # noqa: E712
    ).all()
    n = 0
    for r in rows:
        session.delete(r)
        n += 1
    session.commit()
    if n:
        _tracker_cache_bust()
    return {"kind": kind, "purged": n}


@router.patch("/options/{option_id}", response_model=TrackerOptionRead)
def update_option(
    option_id: str,
    data: TrackerOptionUpdate,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerOptionWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    Option = _tracker_models(team_resolved)["Option"]
    row = session.exec(select(Option).where(Option.id == option_id)).first()
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Option not found")
    _reject_job_status_option_for_candidate_roles(user, row.kind)
    any_change = False
    if data.value is not None:
        row.value = data.value.strip()
        any_change = True
    if getattr(data, "email", None) is not None:
        v = (data.email or "").strip()
        setattr(row, "email", v or None)
        any_change = True
    if getattr(data, "email_enabled", None) is not None:
        setattr(row, "email_enabled", bool(data.email_enabled))
        any_change = True
    if not any_change:
        raise HTTPException(status_code=400, detail="No fields to update")
    _touch_updated_at(row)
    session.add(row)
    session.commit()
    session.refresh(row)
    _tracker_cache_bust()
    return TrackerOptionRead(
        id=row.id,
        kind=row.kind,
        value=row.value,
        email=getattr(row, "email", None),
        email_enabled=bool(getattr(row, "email_enabled", True)),
        is_deleted=row.is_deleted,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.delete("/options/{option_id}", status_code=204)
def delete_option(
    option_id: str,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerOptionWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    Option = _tracker_models(team_resolved)["Option"]
    row = session.exec(select(Option).where(Option.id == option_id)).first()
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Option not found")
    _reject_job_status_option_for_candidate_roles(user, row.kind)
    row.is_deleted = True
    _touch_updated_at(row)
    session.add(row)
    session.commit()
    _tracker_cache_bust()
    return None


@router.delete("/job-openings/{job_opening_id}", status_code=204)
def delete_job_opening(
    job_opening_id: str,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerJobWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    JobOpening = _tracker_models(team_resolved)["JobOpening"]
    row = session.exec(select(JobOpening).where(JobOpening.id == job_opening_id)).first()
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Job opening not found")
    row.is_deleted = True
    _touch_updated_at(row)
    session.add(row)
    session.commit()
    _tracker_cache_bust()
    return None


@router.get("/candidates", response_model=List[TrackerCandidateRead])
def list_candidates(
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    team_resolved = _scoped_team(session, user, team)
    Candidate = _tracker_models(team_resolved)["Candidate"]
    rows = session.exec(
        select(Candidate).where(Candidate.is_deleted == False).order_by(Candidate.created_at.desc())  # noqa: E712
    ).all()
    return [
        TrackerCandidateRead(
            id=r.id,
            name=r.name,
            email=r.email,
            phone=r.phone,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post("/candidates", response_model=TrackerCandidateRead, status_code=201)
def create_candidate(
    data: TrackerCandidateCreate,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    Candidate = _tracker_models(team_resolved)["Candidate"]
    row = Candidate(
        name=data.name,
        email=data.email,
        phone=data.phone,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    _tracker_cache_bust()
    return TrackerCandidateRead(
        id=row.id,
        name=row.name,
        email=row.email,
        phone=row.phone,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.patch("/candidates/{candidate_id}", response_model=TrackerCandidateRead)
def update_candidate(
    candidate_id: str,
    data: TrackerCandidateUpdate,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    Candidate = _tracker_models(team_resolved)["Candidate"]
    row = session.exec(select(Candidate).where(Candidate.id == candidate_id)).first()
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Candidate not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    _touch_updated_at(row)
    session.add(row)
    session.commit()
    session.refresh(row)
    _tracker_cache_bust()
    return TrackerCandidateRead(
        id=row.id,
        name=row.name,
        email=row.email,
        phone=row.phone,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.delete("/candidates/{candidate_id}", status_code=204)
def delete_candidate(
    candidate_id: str,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    Candidate = _tracker_models(team_resolved)["Candidate"]
    row = session.exec(select(Candidate).where(Candidate.id == candidate_id)).first()
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Candidate not found")
    row.is_deleted = True
    _touch_updated_at(row)
    session.add(row)
    session.commit()
    _tracker_cache_bust()
    return None


@router.post("/applications", response_model=TrackerApplicationRead, status_code=201)
def create_application(
    data: TrackerApplicationCreate,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    models = _tracker_models(team_resolved)
    Candidate = models["Candidate"]
    JobOpening = models["JobOpening"]
    Application = models["Application"]
    # Validate candidate exists
    cand = session.exec(select(Candidate).where(Candidate.id == data.candidate_id)).first()
    if not cand or cand.is_deleted:
        raise HTTPException(status_code=400, detail="Invalid candidate_id")
    job_opening_id = (data.job_opening_id or "").strip() or None
    # job_opening_id is optional, only validate if provided
    if job_opening_id:
        job = session.exec(select(JobOpening).where(JobOpening.id == job_opening_id)).first()
        if not job or job.is_deleted:
            raise HTTPException(status_code=400, detail="Invalid job_opening_id")

    row = Application(
        candidate_id=data.candidate_id,
        job_opening_id=job_opening_id,
        applied_date=data.applied_date,
        position=data.position,
        client=data.client,
        status=data.status,
        recruiter=data.recruiter,
        account_manager=data.account_manager,
        recruitment_manager=getattr(data, "recruitment_manager", None),
        comment=data.comment,
        created_by_username=getattr(user, "username", None),
        created_by_role=getattr(user, "role", None),
        created_by_team_location=getattr(user, "team_location", None),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    _tracker_cache_bust()
    return TrackerApplicationRead(
        id=row.id,
        candidate_id=row.candidate_id,
        job_opening_id=row.job_opening_id,
        applied_date=row.applied_date,
        position=row.position,
        client=row.client,
        status=row.status,
        recruiter=row.recruiter,
        account_manager=row.account_manager,
        recruitment_manager=getattr(row, "recruitment_manager", None),
        comment=row.comment,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/applications", response_model=List[TrackerApplicationRead])
def list_applications(
    candidate_id: Optional[str] = None,
    job_opening_id: Optional[str] = None,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    team_resolved = _scoped_team(session, user, team)
    Application = _tracker_models(team_resolved)["Application"]
    q = select(Application)
    if candidate_id:
        q = q.where(Application.candidate_id == candidate_id)
    if job_opening_id:
        q = q.where(Application.job_opening_id == job_opening_id)
    rows = session.exec(q.order_by(Application.created_at.desc())).all()
    return [
        TrackerApplicationRead(
            id=r.id,
            candidate_id=r.candidate_id,
            job_opening_id=r.job_opening_id,
            applied_date=r.applied_date,
            position=r.position,
            client=r.client,
            status=r.status,
            recruiter=r.recruiter,
            account_manager=r.account_manager,
            recruitment_manager=getattr(r, "recruitment_manager", None),
            comment=r.comment,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.get("/candidate-rows", response_model=List[TrackerCandidateRowRead])
def list_candidate_rows(
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    """Convenience endpoint for UI: returns candidate + latest application in one call."""
    team_resolved = _scoped_team(session, user, team)
    cache_hit = _tracker_cache_get(
        team_resolved,
        "candidate_rows",
        f"role={user.role}",
        f"team_location={_norm_team(getattr(user, 'team_location', None) or '')}",
    )
    if cache_hit is not None:
        return cache_hit
    models = _tracker_models(team_resolved)
    Candidate = models["Candidate"]
    Application = models["Application"]
    candidates = session.exec(
        select(Candidate).where(Candidate.is_deleted == False).order_by(Candidate.created_at.desc())  # noqa: E712
    ).all()
    apps = session.exec(select(Application).order_by(Application.created_at.desc())).all()

    # Row-level access safety:
    # Even though we split tables by team, older deployments may have mixed-location rows
    # in the Dubai tables from before the split. For non-admin/EVP users, enforce a strict
    # filter by the immutable creator team location (fallback: editable location only if needed).
    if user.role not in {"admin", "evp"}:
        team_loc = _norm_team(getattr(user, "team_location", None) or "")
        if team_loc:
            apps = [
                a
                for a in apps
                if _norm_team(
                    (getattr(a, "created_by_team_location", None) or "")
                )
                == team_loc
            ]
        else:
            apps = []

    latest_app_by_cand: dict[str, Application] = {}
    for a in apps:
        if a.candidate_id not in latest_app_by_cand:
            latest_app_by_cand[a.candidate_id] = a

    out: list[TrackerCandidateRowRead] = []
    for c in candidates:
        a = latest_app_by_cand.get(c.id)
        # For restricted users, hide candidates with no visible application in their team.
        if user.role not in {"admin", "evp"} and not a:
            continue
        out.append(
            TrackerCandidateRowRead(
                candidate=TrackerCandidateRead(
                    id=c.id,
                    name=c.name,
                    email=c.email,
                    phone=c.phone,
                    created_at=c.created_at,
                    updated_at=c.updated_at,
                ),
                application=(
                    TrackerApplicationRead(
                        id=a.id,
                        candidate_id=a.candidate_id,
                        job_opening_id=a.job_opening_id,
                        applied_date=a.applied_date,
                        position=a.position,
                        client=a.client,
                        status=a.status,
                        recruiter=a.recruiter,
                        account_manager=a.account_manager,
                        recruitment_manager=getattr(a, "recruitment_manager", None),
                        comment=a.comment,
                        created_at=a.created_at,
                        updated_at=a.updated_at,
                    )
                    if a
                    else None
                ),
            )
        )
    # Keep TTL short because this is the heaviest endpoint.
    _tracker_cache_set(
        team_resolved,
        "candidate_rows",
        [o.model_dump() for o in out],
        30,
        f"role={user.role}",
        f"team_location={_norm_team(getattr(user, 'team_location', None) or '')}",
    )
    return out


@router.patch("/applications/{application_id}", response_model=TrackerApplicationRead)
def update_application(
    application_id: str,
    data: TrackerApplicationUpdate,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    Application = _tracker_models(team_resolved)["Application"]
    row = session.exec(select(Application).where(Application.id == application_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    _touch_updated_at(row)
    session.add(row)
    session.commit()
    session.refresh(row)
    _tracker_cache_bust()
    return TrackerApplicationRead(
        id=row.id,
        candidate_id=row.candidate_id,
        job_opening_id=row.job_opening_id,
        applied_date=row.applied_date,
        position=row.position,
        client=row.client,
        status=row.status,
        recruiter=row.recruiter,
        account_manager=row.account_manager,
        recruitment_manager=getattr(row, "recruitment_manager", None),
        comment=row.comment,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/follow-ups", response_model=List[TrackerFollowUpRead])
def list_followups(
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    team_resolved = _scoped_team(session, user, team)
    cache_hit = _tracker_cache_get(team_resolved, "followups")
    if cache_hit is not None:
        return cache_hit
    FollowUp = _tracker_models(team_resolved)["FollowUp"]
    rows = session.exec(
        select(FollowUp)
        .where(FollowUp.is_deleted == False)  # noqa: E712
        .order_by(FollowUp.next_follow_up_date.asc(), FollowUp.created_at.desc())
    ).all()
    out = [
        TrackerFollowUpRead(
            id=r.id,
            client_name=r.client_name,
            position=r.position,
            recruiter_name=r.recruiter_name,
            account_manager=getattr(r, "account_manager", None),
            recruitment_manager=getattr(r, "recruitment_manager", None),
            cv_submitted_date=r.cv_submitted_date,
            current_stage=r.current_stage,
            last_follow_up_date=r.last_follow_up_date,
            next_follow_up_date=r.next_follow_up_date,
            interview_date=r.interview_date,
            client_feedback=r.client_feedback,
            interview_feedback=r.interview_feedback,
            remarks=r.remarks,
            reminder_last_sent_at=getattr(r, "reminder_last_sent_at", None),
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]
    _tracker_cache_set(team_resolved, "followups", [o.model_dump() for o in out], 60)
    return out


@router.post("/follow-ups", response_model=TrackerFollowUpRead, status_code=201)
def create_followup(
    data: TrackerFollowUpCreate,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerFollowUpWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    FollowUp = _tracker_models(team_resolved)["FollowUp"]
    row = FollowUp(
        client_name=data.client_name.strip(),
        position=(data.position.strip() if data.position else None),
        recruiter_name=(data.recruiter_name.strip() if data.recruiter_name else None),
        account_manager=(data.account_manager.strip() if getattr(data, "account_manager", None) else None),
        recruitment_manager=(data.recruitment_manager.strip() if getattr(data, "recruitment_manager", None) else None),
        cv_submitted_date=data.cv_submitted_date,
        current_stage=data.current_stage.strip(),
        last_follow_up_date=data.last_follow_up_date,
        next_follow_up_date=data.next_follow_up_date,
        interview_date=data.interview_date,
        client_feedback=data.client_feedback,
        interview_feedback=data.interview_feedback,
        remarks=data.remarks,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    _tracker_cache_bust()
    return TrackerFollowUpRead(
        id=row.id,
        client_name=row.client_name,
        position=row.position,
        recruiter_name=row.recruiter_name,
        account_manager=getattr(row, "account_manager", None),
        recruitment_manager=getattr(row, "recruitment_manager", None),
        cv_submitted_date=row.cv_submitted_date,
        current_stage=row.current_stage,
        last_follow_up_date=row.last_follow_up_date,
        next_follow_up_date=row.next_follow_up_date,
        interview_date=row.interview_date,
        client_feedback=row.client_feedback,
        interview_feedback=row.interview_feedback,
        remarks=row.remarks,
        reminder_last_sent_at=getattr(row, "reminder_last_sent_at", None),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/manager-settings/followup-email", status_code=200)
def get_followup_email_settings(
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerManagerUser,
):
    team_resolved = _scoped_team(session, user, team)
    Option = _tracker_models(team_resolved)["Option"]

    to_row = session.exec(
        select(Option)
        .where(Option.kind == "followup_email_to")
        .where(Option.is_deleted == False)  # noqa: E712
        .order_by(Option.updated_at.desc())
    ).first()
    cc_row = session.exec(
        select(Option)
        .where(Option.kind == "followup_email_cc")
        .where(Option.is_deleted == False)  # noqa: E712
        .order_by(Option.updated_at.desc())
    ).first()

    return {
        "team": team_resolved,
        "to": (to_row.value if to_row else ""),
        "cc": (cc_row.value if cc_row else ""),
        "enabled": is_followup_email_reminder_enabled(),
    }


@router.put("/manager-settings/followup-email", status_code=200)
def set_followup_email_settings(
    to: str = Query(..., description="comma-separated list of To emails"),
    cc: Optional[str] = Query(default=None, description="comma-separated list of CC emails (optional)"),
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerManagerUser,
):
    team_resolved = _scoped_team(session, user, team)
    Option = _tracker_models(team_resolved)["Option"]

    def upsert(kind: str, value: str):
        existing = session.exec(
            select(Option)
            .where(Option.kind == kind)
            .where(Option.is_deleted == False)  # noqa: E712
            .order_by(Option.updated_at.desc())
        ).first()
        if existing:
            existing.value = value.strip()
            _touch_updated_at(existing)
            session.add(existing)
            session.commit()
            session.refresh(existing)
            return existing
        row = Option(kind=kind, value=value.strip())
        session.add(row)
        session.commit()
        session.refresh(row)
        return row

    upsert("followup_email_to", to)
    # CC can be empty; store empty string for clarity.
    upsert("followup_email_cc", (cc or ""))
    _tracker_cache_bust()
    return {"success": True, "team": team_resolved, "to": to, "cc": (cc or ""), "enabled": is_followup_email_reminder_enabled()}


@router.post("/follow-ups/{followup_id}/send-reminder", status_code=200)
async def send_followup_reminder_now(
    followup_id: str,
    team: Optional[str] = Query(default=None),
    to: Optional[str] = Query(default=None, description="override To list (optional)"),
    cc: Optional[str] = Query(default=None, description="override CC list (optional)"),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerManagerUser,
):
    """
    Manager-triggered "Send now" reminder for a single follow-up row.
    Uses Manager Settings To/CC by default; can be overridden per request.
    """
    if not is_followup_email_reminder_enabled():
        raise HTTPException(status_code=400, detail="Follow-up email reminders are disabled (SEND_EMAIL_REMINDER_FOLLOWUP!=true)")

    team_resolved = _scoped_team(session, user, team)
    models = _tracker_models(team_resolved)
    FollowUp = models["FollowUp"]
    Option = models["Option"]

    row = session.exec(select(FollowUp).where(FollowUp.id == followup_id)).first()
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Follow-up not found")

    # Never send reminders when the current stage indicates the position is closed.
    stage_raw = str(getattr(row, "current_stage", "") or "").strip().lower()
    stage_norm = " ".join(stage_raw.split())
    if stage_norm in {"positions closed", "position closed"}:
        raise HTTPException(status_code=400, detail="Reminder not sent because Current Stage is Positions Closed.")

    def get_opt(kind: str) -> str:
        r = session.exec(
            select(Option)
            .where(Option.kind == kind)
            .where(Option.is_deleted == False)  # noqa: E712
            .order_by(Option.updated_at.desc())
        ).first()
        return (r.value if r else "").strip()

    def lookup_person_email(kind: str, name: Optional[str]) -> tuple[str, bool]:
        if not name or not str(name).strip():
            return "", True
        nm = str(name).strip()
        r = session.exec(
            select(Option)
            .where(Option.kind == kind)
            .where(Option.value == nm)
            .where(Option.is_deleted == False)  # noqa: E712
            .order_by(Option.updated_at.desc())
        ).first()
        if not r:
            return "", True
        email = (getattr(r, "email", None) or "").strip()
        enabled = bool(getattr(r, "email_enabled", True))
        return email, enabled


    to_override = (to or "").strip()
    cc_override = (cc or "").strip()

    # To: Manager Settings (or override). CC: default CC + selected people (or override).
    # Account Manager has an ON/OFF toggle controlling whether reminders should be sent for their rows.
    _am_email, am_enabled = lookup_person_email("account_manager", getattr(row, "account_manager", None))
    if not am_enabled:
        raise HTTPException(status_code=400, detail="Account Manager reminders are OFF for this person.")

    to_final = to_override or get_opt("followup_email_to")
    if not to_final:
        raise HTTPException(status_code=400, detail="Missing To emails. Set it in Manager Settings first.")

    if cc_override:
        cc_final = cc_override
    else:
        base_cc = _split_emails(get_opt("followup_email_cc"))
        rec_email, _rec_enabled = lookup_person_email("recruiter", getattr(row, "recruiter_name", None))
        am_email, _am_enabled2 = lookup_person_email("account_manager", getattr(row, "account_manager", None))
        rm_email, _rm_enabled = lookup_person_email("recruitment_manager", getattr(row, "recruitment_manager", None))
        cc_items = base_cc + _split_emails(rec_email) + _split_emails(am_email) + _split_emails(rm_email)
        cc_final = _join_emails(cc_items)

    payload = TrackerFollowUpRead(
        id=row.id,
        client_name=row.client_name,
        position=row.position,
        recruiter_name=row.recruiter_name,
        account_manager=getattr(row, "account_manager", None),
        recruitment_manager=getattr(row, "recruitment_manager", None),
        cv_submitted_date=row.cv_submitted_date,
        current_stage=row.current_stage,
        last_follow_up_date=row.last_follow_up_date,
        next_follow_up_date=row.next_follow_up_date,
        client_feedback=row.client_feedback,
        interview_feedback=row.interview_feedback,
        remarks=row.remarks,
        reminder_last_sent_at=getattr(row, "reminder_last_sent_at", None),
        created_at=row.created_at,
        updated_at=row.updated_at,
    ).model_dump()

    subject = f"Follow-up Reminder: {row.client_name}" + (f" – {row.position}" if row.position else "")
    html = render_followup_email_html(payload)
    ok = await send_followup_reminder_email(to_emails=to_final, cc_emails=cc_final or None, subject=subject, body_html=html)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to send reminder email")

    row.reminder_last_sent_at = datetime.utcnow()
    _touch_updated_at(row)
    session.add(row)
    session.commit()
    _tracker_cache_bust()
    return {"success": True, "team": team_resolved, "id": row.id, "to": to_final, "cc": cc_final}


@router.patch("/follow-ups/{followup_id}", response_model=TrackerFollowUpRead)
def update_followup(
    followup_id: str,
    data: TrackerFollowUpUpdate,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerFollowUpWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    FollowUp = _tracker_models(team_resolved)["FollowUp"]
    row = session.exec(select(FollowUp).where(FollowUp.id == followup_id)).first()
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        if isinstance(v, str):
            v = v.strip()
        setattr(row, k, v)
    _touch_updated_at(row)
    session.add(row)
    session.commit()
    session.refresh(row)
    _tracker_cache_bust()
    return TrackerFollowUpRead(
        id=row.id,
        client_name=row.client_name,
        position=row.position,
        recruiter_name=row.recruiter_name,
        account_manager=getattr(row, "account_manager", None),
        recruitment_manager=getattr(row, "recruitment_manager", None),
        cv_submitted_date=row.cv_submitted_date,
        current_stage=row.current_stage,
        last_follow_up_date=row.last_follow_up_date,
        next_follow_up_date=row.next_follow_up_date,
        interview_date=row.interview_date,
        client_feedback=row.client_feedback,
        interview_feedback=row.interview_feedback,
        remarks=row.remarks,
        reminder_last_sent_at=getattr(row, "reminder_last_sent_at", None),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.delete("/follow-ups/{followup_id}", status_code=204)
def delete_followup(
    followup_id: str,
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerFollowUpWriteUser,
):
    team_resolved = _scoped_team(session, user, team)
    FollowUp = _tracker_models(team_resolved)["FollowUp"]
    row = session.exec(select(FollowUp).where(FollowUp.id == followup_id)).first()
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    row.is_deleted = True
    _touch_updated_at(row)
    session.add(row)
    session.commit()
    _tracker_cache_bust()
    return None


@router.get("/export/job-openings.xlsx")
def export_job_openings_xlsx(
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    from io import BytesIO
    from openpyxl import Workbook

    team_resolved = _scoped_team(session, user, team)
    JobOpening = _tracker_models(team_resolved)["JobOpening"]
    rows = session.exec(
        select(JobOpening)
        .where(JobOpening.is_deleted == False)  # noqa: E712
        .order_by(JobOpening.created_at.desc())
    ).all()

    wb = Workbook()
    ws = wb.active
    ws.title = "Requirement Status"
    ws.append(
        [
            "S.no",
            "Role",
            "Client",
            "Recruiter",
            "Recruiter Manager",
            "Account Manager",
            "Requirement Date",
            "Submission Date",
            "No of CVs Submitted",
            "Status",
            "Comments",
        ]
    )
    for i, r in enumerate(rows, start=1):
        ws.append(
            [
                i,
                r.title or "",
                getattr(r, "client", None) or "",
                r.hiring_manager or "",
                getattr(r, "recruitment_manager", None) or "",
                r.department or "",
                r.req_date.isoformat() if getattr(r, "req_date", None) else "",
                getattr(r, "submission_date", None).isoformat() if getattr(r, "submission_date", None) else "",
                getattr(r, "cvs_submitted_count", None) if getattr(r, "cvs_submitted_count", None) is not None else "",
                r.status or "",
                getattr(r, "comments", None) or "",
            ]
        )

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    headers = {"Content-Disposition": 'attachment; filename="job_openings.xlsx"'}
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.get("/export/candidates.xlsx")
def export_candidates_xlsx(
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    from io import BytesIO
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Candidates"
    ws.append(
        [
            "Date",
            "Candidate Name",
            "Position",
            "Client",
            "Status",
            "Recruiter",
            "Account Manager",
            "Recruitment Manager",
            "Comment",
        ]
    )

    team_resolved = _scoped_team(session, user, team)
    models = _tracker_models(team_resolved)
    Candidate = models["Candidate"]
    Application = models["Application"]
    candidates_by_id = {
        c.id: c
        for c in session.exec(select(Candidate).where(Candidate.is_deleted == False)).all()  # noqa: E712
    }
    apps = session.exec(select(Application).order_by(Application.created_at.desc())).all()

    for a in apps:
        cand = candidates_by_id.get(a.candidate_id)
        if not cand:
            continue
        ws.append(
            [
                a.applied_date.isoformat() if a.applied_date else "",
                cand.name,
                a.position or "",
                a.client or "",
                a.status or "",
                a.recruiter or "",
                a.account_manager or "",
                getattr(a, "recruitment_manager", None) or "",
                a.comment or "",
            ]
        )

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    headers = {"Content-Disposition": 'attachment; filename="candidates.xlsx"'}
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.get("/export/follow-ups.xlsx")
def export_followups_xlsx(
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    from io import BytesIO
    from openpyxl import Workbook

    team_resolved = _scoped_team(session, user, team)
    FollowUp = _tracker_models(team_resolved)["FollowUp"]
    rows = session.exec(
        select(FollowUp)
        .where(FollowUp.is_deleted == False)  # noqa: E712
        .order_by(FollowUp.next_follow_up_date.asc(), FollowUp.created_at.desc())
    ).all()

    wb = Workbook()
    ws = wb.active
    ws.title = "Follow-ups"
    ws.append(
        [
            "Client Name",
            "Position",
            "Recruiter Name",
            "Account Manager",
            "Recruitment Manager",
            "CV Submitted Date",
            "Current Stage",
            "Follow Up Date",
            "Next Follow-up Date",
            "Last Reminder Sent",
            "Interview Date",
            "Client Feedback",
            "Interview Feedback",
            "Remarks",
        ]
    )
    for r in rows:
        ws.append(
            [
                r.client_name or "",
                r.position or "",
                r.recruiter_name or "",
                r.account_manager or "",
                getattr(r, "recruitment_manager", None) or "",
                r.cv_submitted_date.isoformat() if r.cv_submitted_date else "",
                r.current_stage or "",
                r.last_follow_up_date.isoformat() if r.last_follow_up_date else "",
                r.next_follow_up_date.isoformat() if r.next_follow_up_date else "",
                r.reminder_last_sent_at.isoformat() if getattr(r, "reminder_last_sent_at", None) else "",
                r.interview_date.isoformat() if r.interview_date else "",
                r.client_feedback or "",
                r.interview_feedback or "",
                r.remarks or "",
            ]
        )

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    headers = {"Content-Disposition": 'attachment; filename="follow_ups.xlsx"'}
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


# ---------------------------------------------------------------------------------------------------------------------
# Paged, searched lists for the workspace (the screen loads one page and the next as the reader scrolls).
#
# The filters, the search and the order are applied by the database over every row; each call returns {items, total}. The old list
# endpoints above stay as they are for exports and other callers. `team=all` (admin / EVP) lists both teams together.
# ---------------------------------------------------------------------------------------------------------------------
_PAGE_MAX = 200


def _page_teams(user: User, team: Optional[str]) -> list:
    if (team or "").strip().lower() == "all":
        if user.role not in {"admin", "evp"}:
            raise HTTPException(status_code=403, detail="Only admins can list both teams together")
        return ["dubai", "abudhabi"]
    return [_resolve_tracker_team(user, team)]


def _day(value: Optional[str]):
    if not value:
        return None
    from datetime import date as _date

    try:
        return _date.fromisoformat(value.strip()[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must look like 2026-11-03")


def _contains_any(columns, text_: Optional[str]):
    from sqlalchemy import func as _f

    needle = f"%{(text_ or '').strip().lower()}%"
    return or_c(*[_f.lower(_f.coalesce(c, "")).like(needle) for c in columns])


def _merged_page(per_team, offset: int, limit: int, sort_key, reverse: bool) -> dict:
    """per_team: [(team, count, fetch(offset, n) -> rows)]. One team: the database pages. Several: each team gives its first offset+limit
    rows, they are merged in the requested order and the page is cut from the merge."""
    total = sum(count for _t, count, _f in per_team)
    if len(per_team) == 1:
        team, _count, fetch = per_team[0]
        return {"total": total, "items": [(team, r) for r in fetch(offset, limit)]}
    merged = [(t, r) for t, _count, fetch in per_team for r in fetch(0, offset + limit)]
    merged.sort(key=lambda tr: sort_key(tr[1]), reverse=reverse)
    return {"total": total, "items": merged[offset: offset + limit]}


@router.get("/job-openings/page")
def page_job_openings(
    team: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=200),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=_PAGE_MAX),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    from sqlalchemy import func

    d1, d2 = _day(date_from), _day(date_to)
    per_team = []
    for t in _page_teams(user, team):
        JobOpening = _tracker_models(t)["JobOpening"]
        conds = [JobOpening.is_deleted == False, JobOpening.team == t]  # noqa: E712
        if status_filter and status_filter != "all":
            conds.append(JobOpening.status == status_filter)
        if q and q.strip():
            conds.append(_contains_any([JobOpening.title, JobOpening.client, JobOpening.hiring_manager, JobOpening.department], q))
        if d1:
            conds.append(JobOpening.submission_date >= d1)
        if d2:
            conds.append(JobOpening.submission_date <= d2)
        count = int(session.exec(select(func.count()).select_from(JobOpening).where(*conds)).one() or 0)
        per_team.append((t, count, lambda o, n, JobOpening=JobOpening, conds=conds: session.exec(
            select(JobOpening).where(*conds).order_by(JobOpening.created_at.desc(), JobOpening.id).offset(o).limit(n)).all()))
    page = _merged_page(per_team, offset, limit, lambda r: r.created_at or datetime.min, True)
    return {"total": page["total"], "items": [
        {**TrackerJobOpeningRead.model_validate(r, from_attributes=True).model_dump(mode="json"), "team": t} for t, r in page["items"]]}


@router.get("/follow-ups/page")
def page_followups(
    team: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=200),
    stage: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None, description="Next follow-up on or after"),
    date_to: Optional[str] = Query(default=None, description="Next follow-up on or before"),
    limit: int = Query(default=50, ge=1, le=_PAGE_MAX),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    from sqlalchemy import func

    d1, d2 = _day(date_from), _day(date_to)
    per_team = []
    for t in _page_teams(user, team):
        FollowUp = _tracker_models(t)["FollowUp"]
        conds = [FollowUp.is_deleted == False, FollowUp.team == t]  # noqa: E712
        if stage and stage != "all":
            conds.append(FollowUp.current_stage == stage)
        if q and q.strip():
            conds.append(_contains_any([FollowUp.client_name, FollowUp.position, FollowUp.recruiter_name, FollowUp.account_manager,
                                        FollowUp.recruitment_manager, FollowUp.client_feedback, FollowUp.interview_feedback, FollowUp.remarks], q))
        if d1:
            conds.append(FollowUp.next_follow_up_date >= d1)
        if d2:
            conds.append(FollowUp.next_follow_up_date <= d2)
        count = int(session.exec(select(func.count()).select_from(FollowUp).where(*conds)).one() or 0)
        per_team.append((t, count, lambda o, n, FollowUp=FollowUp, conds=conds: session.exec(
            select(FollowUp).where(*conds).order_by(FollowUp.created_at.desc(), FollowUp.id).offset(o).limit(n)).all()))
    page = _merged_page(per_team, offset, limit, lambda r: r.created_at or datetime.min, True)
    return {"total": page["total"], "items": [
        {**TrackerFollowUpRead.model_validate(r, from_attributes=True).model_dump(mode="json"), "team": t} for t, r in page["items"]]}


def _candidate_rows_select(models: dict, user: User, team: str):
    """(Candidate, latest Application) pairs the user may see, as a select; None when the user may see nothing. Restricted roles see only
    candidates that have an application created by their own team location (the same rule as /candidate-rows)."""
    from sqlalchemy import func

    Candidate, Application = models["Candidate"], models["Application"]
    visible = select(Application.id.label("aid"), Application.candidate_id.label("cid"),
                     func.row_number().over(partition_by=Application.candidate_id, order_by=Application.created_at.desc()).label("rn")
                     ).where(Application.team == team)
    restricted = user.role not in {"admin", "evp"}
    if restricted:
        team_loc = _norm_team(getattr(user, "team_location", None) or "")
        if not team_loc:
            return None
        flat = func.lower(func.replace(func.replace(func.replace(func.coalesce(Application.created_by_team_location, ""), " ", ""), "-", ""), "_", ""))
        visible = visible.where(flat == team_loc)
    latest = visible.subquery()
    sel = (select(Candidate, Application)
           .outerjoin(latest, and_c(latest.c.cid == Candidate.id, latest.c.rn == 1))
           .outerjoin(Application, Application.id == latest.c.aid)
           .where(Candidate.is_deleted == False, Candidate.team == team))  # noqa: E712
    if restricted:
        sel = sel.where(Application.id.is_not(None))
    return sel


@router.get("/candidate-rows/page")
def page_candidate_rows(
    team: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=200),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    date_from: Optional[str] = Query(default=None, description="Applied on or after"),
    date_to: Optional[str] = Query(default=None, description="Applied on or before"),
    sort: str = Query(default="latest", pattern="^(latest|oldest)$"),
    limit: int = Query(default=50, ge=1, le=_PAGE_MAX),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    from datetime import date as _date
    from sqlalchemy import func

    d1, d2 = _day(date_from), _day(date_to)
    per_team = []
    for t in _page_teams(user, team):
        models = _tracker_models(t)
        Candidate, Application = models["Candidate"], models["Application"]
        base = _candidate_rows_select(models, user, t)
        if base is None:
            continue
        if status_filter and status_filter != "all":
            base = base.where(Application.status == status_filter)
        if q and q.strip():
            base = base.where(_contains_any([Candidate.name, Application.position, Application.client, Application.recruiter,
                                             Application.account_manager, Application.recruitment_manager, Application.comment], q))
        if d1:
            base = base.where(Application.applied_date >= d1)
        if d2:
            base = base.where(Application.applied_date <= d2)
        count = int(session.exec(select(func.count()).select_from(base.subquery())).one() or 0)
        applied = func.coalesce(Application.applied_date, _date(1970, 1, 1))
        ordered = base.order_by(applied.desc() if sort == "latest" else applied.asc(), Candidate.created_at.desc(), Candidate.id)
        per_team.append((t, count, lambda o, n, ordered=ordered: session.exec(ordered.offset(o).limit(n)).all()))
    if not per_team:
        return {"total": 0, "items": []}
    page = _merged_page(per_team, offset, limit,
                        lambda ca: (getattr(ca[1], "applied_date", None) or _date(1970, 1, 1)) if ca[1] is not None else _date(1970, 1, 1),
                        sort == "latest")
    return {"total": page["total"], "items": [{
        "candidate": TrackerCandidateRead.model_validate(c, from_attributes=True).model_dump(mode="json"),
        "application": TrackerApplicationRead.model_validate(a, from_attributes=True).model_dump(mode="json") if a is not None else None,
        "team": t} for t, (c, a) in page["items"]]}


@router.get("/summary")
def tracker_summary(
    team: Optional[str] = Query(default=None),
    session: Session = Depends(tracker_session),
    user: User = AllowedTrackerReadUser,
):
    """The numbers on the cards, counted by the database over every row (not over the page on screen)."""
    from sqlalchemy import case, func

    def n(cond):
        return func.coalesce(func.sum(case((cond, 1), else_=0)), 0)

    out = {"requirements": {"total": 0, "open": 0, "submitted": 0, "hold": 0, "closed": 0},
           "selections": {"total": 0, "joined": 0, "backouts": 0, "offerReleased": 0, "offerPending": 0},
           "followups": {"total": 0, "feedbackPending": 0, "positionsClosed": 0, "overdue": 0, "hold": 0, "interviewScheduled": 0}}
    for t in _page_teams(user, team):
        models = _tracker_models(t)
        JobOpening, FollowUp = models["JobOpening"], models["FollowUp"]
        st = func.lower(func.trim(JobOpening.status))
        closed, hold, submitted = st.in_(("closed", "cancelled")), st == "hold", st == "submitted"
        row = session.exec(select(func.count(), n(closed), n(hold), n(submitted)).where(JobOpening.is_deleted == False, JobOpening.team == t)).one()  # noqa: E712
        total, c, h, s_ = (int(x or 0) for x in row)
        out["requirements"]["total"] += total
        out["requirements"]["closed"] += c
        out["requirements"]["hold"] += h
        out["requirements"]["submitted"] += s_
        out["requirements"]["open"] += total - c - h - s_

        rows = _candidate_rows_select(models, user, t)
        if rows is not None:
            Application = models["Application"]
            sub = rows.with_only_columns(Application.status).subquery()
            low = func.lower(func.coalesce(sub.c.status, ""))
            flat = func.replace(func.replace(low, " ", ""), "-", "")
            agg = session.exec(select(
                func.count(),
                n(and_c(low.like("%joined%"), ~low.like("%pending%"))),
                n(or_c(flat.like("%backout%"), flat.like("%backedout%"))),
                n(low.like("%offer released%")),
                n(func.trim(low) == "offer pending"),
            ).select_from(sub)).one()
            total, j, b, orl, op = (int(x or 0) for x in agg)
            out["selections"]["total"] += total
            out["selections"]["joined"] += j
            out["selections"]["backouts"] += b
            out["selections"]["offerReleased"] += orl
            out["selections"]["offerPending"] += op

        stage = func.lower(func.trim(func.coalesce(FollowUp.current_stage, "")))
        overdue = or_c(and_c(FollowUp.next_follow_up_date.is_not(None), FollowUp.next_follow_up_date < func.current_date(), stage != "positions closed"),
                       stage == "overdue follow-ups")
        row = session.exec(select(
            func.count(), n(stage.in_(("feedback pending", "interview feedback pending"))), n(stage.in_(("positions closed", "position closed"))),
            n(overdue), n(stage == "hold"),
            n(or_c(stage == "interview", and_c(stage.like("%interview%"), stage.like("%scheduled%")))),
        ).where(FollowUp.is_deleted == False, FollowUp.team == t)).one()  # noqa: E712
        total, fp, pc, od, hd, isch = (int(x or 0) for x in row)
        f = out["followups"]
        f["total"] += total
        f["feedbackPending"] += fp
        f["positionsClosed"] += pc
        f["overdue"] += od
        f["hold"] += hd
        f["interviewScheduled"] += isch
    return out
