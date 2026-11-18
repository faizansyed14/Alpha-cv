"""Importing Selections & joining from an Excel sheet (the candidates sheet kept before this page existed).

Like the requirements import: the first row must hold exactly the template's column names, choosing a file only says what would happen
to each row, and nothing changes until the import is confirmed.

Each sheet row is matched to what is already on the page, so importing (again) never makes duplicates:
1. a row with the same candidate, position and client is already there: the sheet row is SKIPPED (the existing row is not changed);
2. else an EMPTY row of the same position and client (the row a closed requirement makes by itself): the candidate is filled into it;
3. else a new row.
"""
import io
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func
from sqlmodel import Session, select

from app.api.routers.tracker import MAX_COMMENT, _scope_location
from app.api.routers.tracker_import import MAX_IMPORT_BYTES, OPTIONAL_COLUMNS, People, _date, _key, _names, _read_sheet, _text
from app.api.routers.tracker_selections import MAX_CANDIDATE, require_selection_role
from app.db.database import get_session
from app.models.selection import Selection, SelectionRecruiter
from app.models.user import User
from app.security.logsafe import security_event
from app.security.rbac_rules import LOCATIONS, RECRUITER_ROLES
from app.security.uploads import read_limited

router = APIRouter(prefix="/api/tracker/selections", tags=["tracker"])

COLUMNS = {
    "Date": "date",
    "Candidate Name": "candidate",
    "Position": "position",
    "Client": "client",
    "Status": "status",
    "Recruiter": "recruiter",
    "Account Manager": "sales",
    "Recruitment Manager": "manager",
    "Comment": "comment",
}
EXAMPLE_ROWS = [
    [1, "2026-11-03", "Saleh Alzaabi", "Multimedia", "PGC", "Offer Pending", "Abdul Baqi", "Des", "Asif", "Offer pending"],
    [2, "2026-10-30", "Omer Ali", "Power BI Developer", "NMDC", "Joined", "Advith", "Des", "Asif", "Joined on 2nd Nov"],
]
STATUSES = {"offerpending": "offer_pending", "pending": "offer_pending", "offerreleased": "offer_released", "released": "offer_released",
            "joined": "joined", "backedout": "backed_out", "backout": "backed_out", "backedoff": "backed_out"}
LABEL = {"offer_pending": "Offer Pending", "offer_released": "Offer Released", "joined": "Joined", "backed_out": "Backed Out"}


def _plan(raw: Dict[str, Any], session: Session, user: User, people: People, taken: set) -> Dict[str, Any]:
    problems: List[str] = []
    notes: List[str] = []
    missing: List[Dict[str, str]] = []
    candidate, position, client = _text(raw.get("candidate")), _text(raw.get("position")), _text(raw.get("client"))
    comment = _text(raw.get("comment"))
    for value, label, limit in ((candidate, "candidate name", MAX_CANDIDATE), (position, "position", 160), (client, "client", 160)):
        if not value:
            problems.append(f"no {label}")
        elif len(value) > limit:
            problems.append(f"the {label} is longer than {limit} characters")
    if comment and len(comment) > MAX_COMMENT:
        problems.append(f"the comment is longer than {MAX_COMMENT} characters")
    day, bad = _date(raw.get("date"))
    if bad:
        problems.append(bad)
    elif day is None:
        day = date.today()
        notes.append("no date: today's date is used")
    elif not 2000 <= day.year <= 2100:
        problems.append(f"the date {day:%d %b %Y} does not look right")
    status_value = STATUSES.get(_key(raw.get("status")) or "offerpending")
    if not status_value:
        problems.append(f"status '{_text(raw.get('status'))}' is not one of Offer Pending, Offer Released, Joined, Backed Out")

    recruiters: List[User] = []
    sheet_recruiters = _names(raw.get("recruiter"))[:10]
    for name in sheet_recruiters:
        found, problem = people.find(name, RECRUITER_ROLES)
        if problem:
            problems.append(f"recruiter: {problem}")
            if problem.startswith("no active login"):
                missing.append({"name": name, "role": "Recruiter"})
        elif found.id not in {r.id for r in recruiters}:
            recruiters.append(found)
    found_people: Dict[str, Optional[User]] = {"manager": None, "sales": None}
    sheet_people: Dict[str, Optional[str]] = {"manager": None, "sales": None}
    for field, role, label in (("manager", ("manager",), "recruitment manager"), ("sales", ("account_manager",), "account manager")):
        names = _names(raw.get(field))
        if names:
            sheet_people[field] = names[0]
            found, problem = people.find(names[0], role)
            if problem:
                problems.append(f"{label}: {problem}")
                if problem.startswith("no active login"):
                    missing.append({"name": names[0], "role": label.capitalize()})
            else:
                found_people[field] = found

    # which location the row belongs to: the person importing it's own; for the EVP and the admin, the people's (all in one)
    own = _scope_location(user)
    places = {u.location for u in recruiters + [p for p in found_people.values() if p] if u.location in LOCATIONS}
    location = own
    if not problems:
        if own is not None and places - {own}:
            problems.append(f"someone on this row works in {', '.join(sorted(places - {own}))}, not {own}")
        elif own is None:
            if len(places) > 1:
                problems.append("the people on this row work in different locations")
            location = next(iter(places), None)

    outcome, target = ("error", None)
    if not problems:
        key = "row:" + "|".join(v.lower() for v in (candidate, position, client))
        same = session.exec(select(Selection.id).where(
            func.lower(Selection.candidate_name) == candidate.lower(), func.lower(Selection.position) == position.lower(),
            func.lower(Selection.client) == client.lower(), *( [Selection.location == own] if own else [] ))).first()
        if same is not None or key in taken:
            outcome = "exists"                                   # already on the page, or earlier in this sheet: skipped, never changed
            if same is None:
                notes.append("the same candidate, position and client appear earlier in this sheet")
        else:
            taken.add(key)
            empty = session.exec(select(Selection).where(
                Selection.candidate_name.is_(None), func.lower(Selection.position) == position.lower(),
                func.lower(Selection.client) == client.lower(), Selection.id.notin_(taken or {""}),
                *( [Selection.location == own] if own else [] )).order_by(Selection.selection_date)).first()
            target, outcome = (empty, "fill") if empty is not None else (None, "new")
        if target is not None:
            taken.add(target.id)
    return {
        "row": raw["row"], "outcome": outcome, "problems": problems, "notes": [] if problems else notes, "missing": missing,
        "candidate_name": candidate, "position": position, "client": client, "date": day.isoformat() if day else None,
        "status": status_value, "comments": comment,
        "sheet": {"recruiters": sheet_recruiters, "manager": sheet_people["manager"], "sales_manager": sheet_people["sales"]},
        "_apply": {"target": target.id if target is not None else None, "day": day, "location": location,
                   "recruiters": [r.id for r in recruiters], "manager": found_people["manager"].id if found_people["manager"] else None,
                   "sales": found_people["sales"].id if found_people["sales"] else None},
    }


def _write(session: Session, user: User, plan: Dict[str, Any]) -> None:
    a = plan["_apply"]
    row = session.get(Selection, a["target"]) if a["target"] else None
    if row is None:
        row = Selection(location=a["location"], selection_date=a["day"], position=plan["position"], client=plan["client"], status=plan["status"])
    row.candidate_name, row.selection_date, row.status, row.comments = plan["candidate_name"], a["day"], plan["status"], plan["comments"]
    row.manager_id, row.sales_manager_id = a["manager"], a["sales"]
    row.location = row.location or a["location"]
    row.updated_by, row.updated_at = user.username, datetime.utcnow()
    session.add(row)
    session.flush()
    for link in session.exec(select(SelectionRecruiter).where(SelectionRecruiter.selection_id == row.id)).all():
        session.delete(link)
    session.flush()
    for position, rid in enumerate(a["recruiters"]):
        session.add(SelectionRecruiter(selection_id=row.id, recruiter_id=rid, position=position))


@router.get("/import/columns")
def import_columns(user: User = Depends(require_selection_role)):
    return {"columns": list(COLUMNS), "optional": list(OPTIONAL_COLUMNS), "example_rows": EXAMPLE_ROWS}


@router.get("/import/template")
def import_template(user: User = Depends(require_selection_role)):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = "Selections"
    ws.append(list(OPTIONAL_COLUMNS) + list(COLUMNS))
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="16204B")
    for row in EXAMPLE_ROWS:
        ws.append(row)
    for col, width in zip("ABCDEFGHIJ", (6, 12, 30, 24, 16, 16, 16, 18, 20, 40)):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "A2"
    out = io.BytesIO()
    wb.save(out)
    return Response(out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="selections-import-template.xlsx"', "Cache-Control": "no-store"})


@router.post("/import")
async def import_selections(
    file: UploadFile = File(...),
    apply: bool = Query(False, description="false: only say what would happen; true: add the rows that are fine"),
    user: User = Depends(require_selection_role),
    session: Session = Depends(get_session),
):
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose an Excel file (.xlsx).")
    data = await read_limited(file, MAX_IMPORT_BYTES)
    if not data.startswith(b"PK"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This is not an Excel (.xlsx) file that can be read.")
    rows, _unknown = _read_sheet(data, COLUMNS)
    people = People(session)
    taken: set = set()
    plans = [_plan(r, session, user, people, taken) for r in rows]
    done = {"new": 0, "fill": 0}
    if apply:
        for plan in plans:
            if plan["outcome"] in done:
                _write(session, user, plan)
                done[plan["outcome"]] += 1
        session.commit()
        security_event("selections_imported", by=user.username, rows=len(plans), **done)
    count = lambda o: sum(1 for p in plans if p["outcome"] == o)
    needed: Dict[Tuple[str, str], int] = {}
    for p in plans:
        for m in {(m["name"], m["role"]) for m in p["missing"]}:
            needed[m] = needed.get(m, 0) + 1
    return {
        "applied": apply, "created": done["new"] + done["fill"],
        "summary": {"rows": len(plans), "new": count("new"), "fill": count("fill"), "exists": count("exists"),
                    "error": count("error"), "with_notes": sum(1 for p in plans if p["notes"])},
        "missing_logins": [{"name": n, "role": r, "rows": c} for (n, r), c in sorted(needed.items(), key=lambda x: (-x[1], x[0]))],
        "rows": [{k: v for k, v in p.items() if k != "_apply"} for p in plans],
    }
