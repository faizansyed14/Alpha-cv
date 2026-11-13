"""Closures and analytics for the requirements tracker.

A requirement that is closed leaves the requirements lists and appears here, credited to the recruiter it was assigned to.
* A recruiter sees their own closures and their own analytics.
* The sales manager, recruitment manager, EVP and admin see every recruiter's closures and performance (a manager or sales manager only
  for their own location; the EVP and the admin for both).
"""
from collections import defaultdict
from datetime import date, datetime
from statistics import median
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func
from sqlmodel import Session, select

from app.api.deps import require_core_app
from app.api.routers.tracker import (
    Filters, MAX_EXPORT_ROWS, _conditions, _cvs_summary, _duration_text, _filters, _is_recruiter, _links_for, _names, _recruiters_text, _scope_location, _who,
    _views, _xlsx,
)
from app.db.database import get_session
from app.models.requirement import Requirement, RequirementRecruiter
from app.models.user import User
from app.security.logsafe import security_event
from app.security.rbac_rules import ALL_LOCATIONS_ROLES, LOCATIONS

router = APIRouter(prefix="/api/tracker", tags=["tracker"])

MAX_ANALYTICS_ROWS = 100000
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _days(requirement_date: date, closed_at: datetime) -> int:
    return max(0, (closed_at.date() - requirement_date).days)


def _average(values: List[int]) -> Optional[float]:
    return round(sum(values) / len(values), 1) if values else None


def _month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def _month_bounds(year: int, month: int) -> tuple:
    """The first moment of the month and of the next one."""
    return datetime(year, month, 1), datetime(year + (month == 12), month % 12 + 1, 1)


# ----------------------------------------------------------------------------------------------------------------- closures

@router.get("/closures")
def list_closures(
    f: Filters = Depends(_filters),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0, le=100000),
    user: User = Depends(require_core_app),
    session: Session = Depends(get_session),
):
    """The closed requirements (newest first) with who they are credited to. The dates filter the day it was closed."""
    conds = _conditions(user, f, with_status=False, closed="only")
    total = session.exec(select(func.count()).select_from(Requirement).where(*conds)).one()
    rows = session.exec(select(Requirement).where(*conds).order_by(Requirement.closed_at.desc(), Requirement.id).offset(offset).limit(limit)).all()
    pairs = session.exec(select(Requirement.requirement_date, Requirement.closed_at).where(*conds).limit(MAX_ANALYTICS_ROWS)).all()
    days = [_days(r, c) for r, c in pairs if c]
    month = _month_start(datetime.utcnow().date())
    closed_dates = session.exec(select(Requirement.closed_at).where(*_conditions(user, Filters(), with_status=False, closed="only")).limit(MAX_ANALYTICS_ROWS)).all()
    return {
        "items": _views(session, rows, user),
        "total": int(total),
        "years": sorted({c.year for c in closed_dates if c}, reverse=True),
        "summary": {
            "closed": int(total),
            "closed_this_month": sum(1 for _, c in pairs if c and c.date() >= month),
            "avg_days": _average(days),
        },
    }


@router.get("/closures/export")
def export_closures(f: Filters = Depends(_filters), user: User = Depends(require_core_app), session: Session = Depends(get_session)):
    rows = session.exec(select(Requirement).where(*_conditions(user, f, with_status=False, closed="only"))
                        .order_by(Requirement.closed_at.desc(), Requirement.id).limit(MAX_EXPORT_ROWS)).all()
    links = _links_for(session, [r.id for r in rows])
    names = _names(session, [l.recruiter_id for ls in links.values() for l in ls] + [r.manager_id for r in rows] + [r.sales_manager_id for r in rows])
    recruiter_view = _is_recruiter(user)
    # the columns are the page's, in its order; "Closed by" (who marked it closed) is the one extra, last
    columns = [("S.No", 7), ("Position", 34), ("Client", 26), ("Recruiter", 18), ("Recruitment manager", 20), ("Sales manager", 18),
               ("Requirement date", 16), ("Submission deadline", 20), ("CVs submitted on", 18), ("No. of CVs submitted", 14), ("Status", 12)]
    if not recruiter_view:
        columns.append(("Sales manager comments", 40))
    columns += [("Recruitment manager comments", 40), ("Recruiter comments", 40), ("Job location", 22), ("Salary", 18), ("Job duration", 22),
                ("Closed on", 18), ("Days to close", 14), ("Closed by", 18)]
    data: List[List[Any]] = []
    for n, r in enumerate(rows, start=1):
        values: List[Any] = [n, r.position, r.client, _recruiters_text(r, links.get(r.id, []), names), _who(names, r.manager_id), _who(names, r.sales_manager_id),
                             r.requirement_date, r.cv_submission_date, *_cvs_summary(links.get(r.id, []), user), "Closed"]
        if not recruiter_view:
            values.append(r.sales_comments or "")
        values += [r.rm_comments or "", r.recruiter_comments or "", r.job_location or "", r.salary or "",
                   _duration_text(r.duration_type, r.duration_value, r.duration_unit, r.duration_extendable) or "",
                   r.closed_at, max(0, (r.closed_at.date() - r.requirement_date).days) if r.closed_at else "", r.closed_by or ""]
        data.append(values)
    security_event("closures_exported", by=user.username, rows=len(rows))
    name = f"closures-{date.today().isoformat()}.xlsx"
    return Response(_xlsx("Closures", columns, data), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


# ----------------------------------------------------------------------------------------------------------------- analytics

def _zero_place() -> Dict[str, Any]:
    return {"closed": 0, "previous_closed": 0, "received": 0, "open": 0, "submitted": 0, "hold": 0, "canceled": 0, "overdue": 0, "days": [], "cvs": 0}


@router.get("/analytics")
def analytics(
    view: str = Query("monthly", pattern="^(monthly|yearly)$"),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    location: Optional[str] = Query(None, max_length=32),
    user: User = Depends(require_core_app),
    session: Session = Depends(get_session),
):
    """The tracker's numbers for one month (by day) or one year (by month): what came in, what was closed and by whom, how fast, how many CVs
    were submitted, what is open now and what is overdue, compared with the month or year before.

    * A recruiter gets their own numbers.
    * The recruitment manager and the sales manager get every recruiter of their location.
    * The EVP and the admin get every location together, with a Dubai and Abu Dhabi comparison, or one location (``location``).
    A closed requirement is credited to its lead recruiter only; open work counts for every recruiter on it; a canceled requirement is counted
    on its own, being neither active work nor a closure."""
    conds = _conditions(user, Filters(location=location), with_status=False, closed="any")
    rows = session.exec(
        select(Requirement.id, Requirement.recruiter_id, Requirement.status, Requirement.requirement_date, Requirement.closed_at, Requirement.client,
               Requirement.position, Requirement.location, Requirement.cv_submission_date)
        .where(*conds).limit(MAX_ANALYTICS_ROWS)
    ).all()
    # every recruiter on a requirement that is still open (or canceled) has it in his numbers; a closed one is credited to its lead recruiter only
    assigned = _links_for(session, [row[0] for row in rows if row[2] != "closed"])

    now = datetime.utcnow()
    today = now.date()
    year, month = year or now.year, month or now.month
    if view == "yearly":
        start, end = datetime(year, 1, 1), datetime(year + 1, 1, 1)
        prev_start, prev_end, label, prev_label = datetime(year - 1, 1, 1), start, str(year), str(year - 1)
    else:
        start, end = _month_bounds(year, month)
        py, pm = (year - 1, 12) if month == 1 else (year, month - 1)
        prev_start, prev_end = _month_bounds(py, pm)
        label, prev_label = f"{MONTH_NAMES[month - 1]} {year}", f"{MONTH_NAMES[pm - 1]} {py}"
    start_d, end_d, prev_start_d, prev_end_d = start.date(), end.date(), prev_start.date(), prev_end.date()
    yearly = view == "yearly"
    bucket = (lambda d: d.month) if yearly else (lambda d: d.day)
    show_locations = user.role in ALL_LOCATIONS_ROLES and location not in LOCATIONS

    per: Dict[Optional[str], Dict[str, Any]] = defaultdict(lambda: {"closed": 0, "days": [], "open": 0, "submitted": 0, "hold": 0, "canceled": 0, "cvs": 0, "last": None})
    places: Dict[Optional[str], Dict[str, Any]] = defaultdict(_zero_place)
    closed_by_bucket: Dict[int, int] = defaultdict(int)
    received_by_bucket: Dict[int, int] = defaultdict(int)
    clients: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"closed": 0, "days": []})
    all_days: List[int] = []
    closures: List[tuple] = []
    active = {"open": 0, "submitted": 0, "hold": 0}
    canceled = overdue = received = previous_received = closed_in_period = previous_closed = 0
    years_seen = {now.year, year}
    for requirement_id, recruiter_id, status, requirement_date, closed_at, client, position, place, deadline in rows:
        here = places[place]
        if start_d <= requirement_date < end_d:                       # it came in during the period
            received += 1
            here["received"] += 1
            received_by_bucket[bucket(requirement_date)] += 1
        elif prev_start_d <= requirement_date < prev_end_d:
            previous_received += 1
        if status == "closed":
            if not closed_at:
                continue
            if _is_recruiter(user) and recruiter_id != user.id:
                continue                                   # a recruiter's analytics are the closures credited to him
            years_seen.add(closed_at.year)
            if prev_start <= closed_at < prev_end:
                previous_closed += 1
                here["previous_closed"] += 1
            if not (start <= closed_at < end):
                continue
            who = per[recruiter_id]
            who["closed"] += 1
            d = _days(requirement_date, closed_at)
            who["days"].append(d)
            all_days.append(d)
            here["closed"] += 1
            here["days"].append(d)
            if who["last"] is None or closed_at > who["last"]:
                who["last"] = closed_at
            closed_by_bucket[bucket(closed_at)] += 1
            clients[client]["closed"] += 1
            clients[client]["days"].append(d)
            closures.append((closed_at, position, client, recruiter_id, d, place))
            closed_in_period += 1
        else:
            who_ids = [l.recruiter_id for l in assigned.get(requirement_id, [])] or [recruiter_id]
            if status == "canceled":
                for rid in who_ids:
                    per[rid]["canceled"] += 1
                here["canceled"] += 1
                canceled += 1
                continue
            for rid in who_ids:
                per[rid][status] += 1
            here[status] += 1
            active[status] += 1
            if status in ("open", "hold") and deadline and deadline < today:       # the day CVs were due to the client has passed
                overdue += 1
                here["overdue"] += 1

    # the CVs the recruiters submitted in the period (each recruiter's own numbers)
    cvs_total = 0
    cv_rows = (select(RequirementRecruiter.recruiter_id, RequirementRecruiter.cvs_submitted_count, Requirement.location)
               .select_from(RequirementRecruiter).join(Requirement, Requirement.id == RequirementRecruiter.requirement_id)
               .where(*conds, RequirementRecruiter.cvs_submitted_count.is_not(None), RequirementRecruiter.cvs_submitted_date >= start_d,
                      RequirementRecruiter.cvs_submitted_date < end_d))
    if _is_recruiter(user):
        cv_rows = cv_rows.where(RequirementRecruiter.recruiter_id == user.id)
    for rid, n, place in session.exec(cv_rows).all():
        per[rid]["cvs"] += int(n)
        places[place]["cvs"] += int(n)
        cvs_total += int(n)

    # every day of the month, or every month of the year, so a quiet one shows as zero
    if yearly:
        series = [{"key": f"{year}-{i:02d}", "label": MONTHS[i - 1], "closed": closed_by_bucket.get(i, 0), "received": received_by_bucket.get(i, 0)} for i in range(1, 13)]
    else:
        series = [{"key": f"{year}-{month:02d}-{d:02d}", "label": str(d), "closed": closed_by_bucket.get(d, 0), "received": received_by_bucket.get(d, 0)}
                  for d in range(1, (end - start).days + 1)]

    # every active recruiter in scope is listed, including those with no closures yet
    own = _scope_location(user) if user.role not in ALL_LOCATIONS_ROLES else (location if location in LOCATIONS else None)
    if _is_recruiter(user):
        listed = {user.id}
    else:
        q = select(User).where(User.role == "user", User.is_active == True)            # noqa: E712
        q = q.where(User.location == own) if own else q.where(User.location.in_(LOCATIONS))      # a recruiter with no location has nothing to show
        listed = {u.id for u in session.exec(q).all()} | {k for k in per if k}
    closer_ids = {c[3] for c in closures if c[3]}
    info = {u.id: (u.username, u.location) for u in session.exec(select(User).where(User.id.in_(listed | closer_ids))).all()} if (listed | closer_ids) else {}
    people = []
    for rid in listed | ({None} if None in per and not _is_recruiter(user) else set()):
        p = per.get(rid)
        name, where = info.get(rid or "", ("Unassigned" if rid is None else "Former user", None))
        people.append({
            "id": rid,
            "username": name,
            "location": where,
            "closed": p["closed"] if p else 0,
            "avg_days": _average(p["days"]) if p else None,
            "cvs_submitted": p["cvs"] if p else 0,
            "open": p["open"] if p else 0,
            "submitted": p["submitted"] if p else 0,
            "hold": p["hold"] if p else 0,
            "canceled": p["canceled"] if p else 0,
            "last_closed": p["last"].isoformat() + "Z" if p and p["last"] else None,
        })
    people.sort(key=lambda x: (-x["closed"], -x["cvs_submitted"], -(x["open"] + x["submitted"] + x["hold"]), x["username"].lower()))

    # Dubai and Abu Dhabi side by side, for the EVP and the admin looking at both
    locations: List[Dict[str, Any]] = []
    if show_locations:
        recruiters_in = dict(session.exec(select(User.location, func.count()).where(User.role == "user", User.is_active == True)   # noqa: E712
                                          .where(User.location.in_(LOCATIONS)).group_by(User.location)).all())
        for place in list(LOCATIONS) + ([None] if None in places else []):
            d = places[place]
            locations.append({
                "location": place, "recruiters": int(recruiters_in.get(place, 0)) if place else 0,
                "received": d["received"], "closed": d["closed"], "previous_closed": d["previous_closed"], "avg_days": _average(d["days"]),
                "cvs_submitted": d["cvs"], "active": d["open"] + d["submitted"] + d["hold"],
                "open": d["open"], "submitted": d["submitted"], "hold": d["hold"], "canceled": d["canceled"], "overdue": d["overdue"],
            })

    recent = sorted(closures, key=lambda c: c[0], reverse=True)[:10]
    return {
        "view": view,
        "year": year,
        "month": month if view == "monthly" else None,
        "label": label,
        "location": location if user.role in ALL_LOCATIONS_ROLES and location in LOCATIONS else None,       # only when the EVP or the admin actually filtered
        "scope": "own" if _is_recruiter(user) else "team",
        "summary": {
            "received": received,
            "previous_received": previous_received,
            "closed": closed_in_period,
            "previous_closed": previous_closed,
            "previous_label": prev_label,
            "avg_days": _average(all_days),
            "median_days": round(median(all_days), 1) if all_days else None,
            "cvs_submitted": cvs_total,
            "active": active,
            "active_total": sum(active.values()),
            "canceled": canceled,
            "overdue": overdue,
        },
        "series": series,
        "years": sorted(years_seen, reverse=True),
        "locations": locations,
        "recruiters": people,
        "clients": [{"client": c, "closed": v["closed"], "avg_days": _average(v["days"])}
                    for c, v in sorted(clients.items(), key=lambda kv: (-kv[1]["closed"], kv[0].lower()))[:6]],
        "closures": [{"position": c[1], "client": c[2], "recruiter": info.get(c[3] or "", ("Unassigned", None))[0], "location": c[5],
                      "closed_at": c[0].isoformat() + "Z", "days": c[4]} for c in recent],
    }
