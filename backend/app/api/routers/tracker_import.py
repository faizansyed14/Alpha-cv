"""Importing requirements from an Excel sheet (the requirements tracker kept in Excel before this page existed).

Two steps, the same endpoint: without ``apply`` it only READS the sheet and says, row by row, what would happen (imported, already in the
tracker, or what is wrong with it); with ``apply`` it imports the rows that are fine, all in one transaction. Rows that are already in the
tracker (same role, client and requirement date) are never imported twice, so the same file can be imported again safely.

The first row must hold EXACTLY the template's column names (COLUMNS below; capitals and extra spaces do not matter, the order does not
matter, "S.no" may be there or not). A sheet with a missing, misspelt or extra column is refused before any row is read, and the answer
names what is missing and what is not expected. GET /requirements/import/template gives the template with two example rows.
People are matched to logins by their name: the username, its first word, or the part of the e-mail before the @.
"""
import io
import re
from datetime import date, datetime, time
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import func
from sqlmodel import Session, select

from app.api.deps import require_core_app
from app.api.routers.tracker import (
    MAX_RECRUITERS, RequirementIn, _check_manager, _check_recruiters, _event, _require_full, _scope_location, _set_assignees,
)
from app.db.database import get_session
from app.models.requirement import MAX_CVS_SUBMITTED, Requirement, RequirementRecruiter
from app.models.user import User
from app.security.logsafe import security_event
from app.security.rbac_rules import RECRUITER_ROLES
from app.security.uploads import read_limited
from app.services.selections import create_for_closed

router = APIRouter(prefix="/api/tracker", tags=["tracker"])

MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 2000

# the template's columns, exactly as the sheet must name them -> what each holds
COLUMNS = {
    "Role": "position",
    "Client": "client",
    "Recruiter": "recruiter",
    "Recruiter Manager": "manager",
    "Account Manager": "sales",
    "Requirement Date": "requirement_date",
    "Submission Date": "cvs_date",
    "No of CVs Submitted": "cvs_count",
    "Status": "status",
    "Comments": "comments",
}
OPTIONAL_COLUMNS = ("S.no",)
EXAMPLE_ROWS = [
    [1, "IT Support Engineer", "Response Plus", "Shalini", "Asif", "Harris", "2026-10-05", "2026-10-05", 7, "Submitted", "7 profiles submitted on 5th Oct"],
    [2, "Data Scientist", "Saal", "Arsalan, Mary", "Asif", "Moin", "2026-10-06", "", "", "Open", ""],
]


def _header_key(title: Any) -> str:
    """A column name as it is compared: capitals and extra spaces do not count, the words and their spelling do."""
    return " ".join(str(title or "").split()).casefold()
STATUSES = {"open": "open", "submitted": "submitted", "hold": "hold", "onhold": "hold", "closed": "closed", "canceled": "canceled",
            "cancelled": "canceled"}


def _key(text: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def _text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = " ".join(str(value).split())
    return text or None


def _date(value: Any) -> Tuple[Optional[date], Optional[str]]:
    """(the date, a problem): Excel dates, 2026-10-05, 05/10/2026 (day first), 5-Oct-2026."""
    if value in (None, ""):
        return None, None
    if isinstance(value, datetime):
        return value.date(), None
    if isinstance(value, date):
        return value, None
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d-%b-%Y", "%d %b %Y", "%d %B %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date(), None
        except ValueError:
            continue
    return None, f"'{text}' is not a date"


def _names(cell: Any) -> List[str]:
    """One or more people in a cell: "Mary", "Mary, Faraz", "Mary & Faraz", "Mary / Faraz", "Mary and Faraz"."""
    text = _text(cell)
    if not text:
        return []
    return [n.strip() for n in re.split(r"\s*(?:,|&|/|;|\band\b)\s*", text) if n.strip()]


class People:
    """The active logins this importer may assign, found by name."""

    def __init__(self, session: Session):
        self.users = list(session.exec(select(User).where(User.is_active == True)).all())   # noqa: E712

    def find(self, name: str, roles: Tuple[str, ...]) -> Tuple[Optional[User], Optional[str]]:
        want = _key(name)
        pool = [u for u in self.users if u.role in roles]
        for test in (lambda u: _key(u.username) == want,
                     lambda u: _key((u.username or "").split()[0] if (u.username or "").split() else "") == want
                     or _key(re.split(r"[._\-\s]", u.username or "")[0]) == want,
                     lambda u: _key((u.email or "").split("@")[0]) == want
                     or _key(re.split(r"[._\-]", (u.email or "").split("@")[0])[0]) == want):
            hits = [u for u in pool if test(u)]
            if len(hits) == 1:
                return hits[0], None
            if len(hits) > 1:
                return None, f"'{name}' matches several logins ({', '.join(sorted(u.username for u in hits))}): use the full username in the sheet"
        return None, f"no active login called '{name}'"


def _read_sheet(data: bytes, template: Optional[Dict[str, str]] = None) -> Tuple[List[Dict[str, Any]], List[str]]:
    """The rows as {field: cell} with their sheet row number. ``template``: {column name: field} the first row must match exactly."""
    template = template or COLUMNS
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This is not an Excel (.xlsx) file that can be read.") from exc
    try:
        ws = wb.worksheets[0]
        rows = ws.iter_rows(values_only=True)
        header = next(rows, None) or ()
        wanted = {_header_key(name): field for name, field in template.items()}
        optional = {_header_key(name) for name in OPTIONAL_COLUMNS}
        columns: Dict[str, int] = {}
        unknown, repeated = [], []
        for i, title in enumerate(header):
            k = _header_key(title)
            if not k or k in optional:
                continue
            if k not in wanted:
                unknown.append(str(title).strip())
            elif wanted[k] in columns:
                repeated.append(str(title).strip())
            else:
                columns[wanted[k]] = i
        missing = [name for name, field in template.items() if field not in columns]
        if missing or unknown or repeated:
            parts = []
            if missing:
                parts.append("missing: " + ", ".join(missing))
            if unknown:
                parts.append("not expected: " + ", ".join(unknown))
            if repeated:
                parts.append("twice: " + ", ".join(repeated))
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="The column names do not match the template (" + "; ".join(parts) + "). Nothing was imported. "
                                       "The first row must be exactly: " + ", ".join(template) + ".")
        out = []
        for n, values in enumerate(rows, start=2):
            if n - 1 > MAX_IMPORT_ROWS:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"The sheet has more than {MAX_IMPORT_ROWS} rows; split it.")
            row = {f: (values[i] if i < len(values) else None) for f, i in columns.items()}
            if any(_text(v) for v in row.values()):
                out.append({"row": n, **row})
        return out, unknown
    finally:
        wb.close()


def _plan_row(raw: Dict[str, Any], session: Session, user: User, people: People, seen: set) -> Dict[str, Any]:
    """What would happen to one row: {outcome: import | exists | error, problems, notes, and the values}."""
    problems: List[str] = []
    notes: List[str] = []
    position, client = _text(raw.get("position")), _text(raw.get("client"))
    req_date, p1 = _date(raw.get("requirement_date"))
    cvs_date, p2 = _date(raw.get("cvs_date"))
    problems += [p for p in (p1, p2) if p]
    status_text = _key(raw.get("status")) or "open"
    status_value = STATUSES.get(status_text)
    if not status_value:
        problems.append(f"status '{_text(raw.get('status'))}' is not one of Open, Submitted, Hold, Closed, Canceled")

    if req_date is None and not p1:
        req_date = cvs_date or date.today()
        notes.append("no requirement date: " + ("the submission date is used" if cvs_date else "today's date is used"))
    if req_date and cvs_date and cvs_date < req_date:
        notes.append(f"CVs were submitted ({cvs_date:%d %b %Y}) before the requirement date: the requirement date is set to that day")
        req_date = cvs_date

    count = None
    count_text = _text(raw.get("cvs_count"))
    if count_text:
        try:
            count = int(float(count_text))
            if not 0 <= count <= MAX_CVS_SUBMITTED:
                raise ValueError
        except ValueError:
            notes.append(f"'{count_text}' is not a number of CVs: left empty")
            count = None

    recruiters: List[User] = []
    missing: List[Dict[str, str]] = []          # names with no login, so the screen can list the logins to create
    sheet_recruiters = _names(raw.get("recruiter"))[:MAX_RECRUITERS]
    for name in sheet_recruiters:
        found, problem = people.find(name, RECRUITER_ROLES)
        if problem:
            problems.append(f"recruiter: {problem}")
            if problem.startswith("no active login"):
                missing.append({"name": name, "role": "Recruiter"})
        elif found.id not in {r.id for r in recruiters}:
            recruiters.append(found)
    manager = sales = None
    sheet_people = {"manager": None, "sales": None}
    for field, role, label in (("manager", ("manager",), "recruitment manager"), ("sales", ("account_manager",), "sales manager")):
        names = _names(raw.get(field))
        if names:
            sheet_people[field] = names[0]
            found, problem = people.find(names[0], role)
            if problem:
                problems.append(f"{label}: {problem}")
                if problem.startswith("no active login"):
                    missing.append({"name": names[0], "role": label.capitalize()})
            elif field == "manager":
                manager = found
            else:
                sales = found

    comments = _text(raw.get("comments"))
    try:
        RequirementIn(requirement_date=req_date or date.today(), position=position or "", client=client or "", recruiter_comments=comments,
                      status=status_value or "open")
    except ValidationError as exc:
        for err in exc.errors():
            problems.append(f"{'/'.join(str(x) for x in err.get('loc', ()))}: {err.get('msg')}")

    # who may be assigned from where (the same checks as adding one by hand)
    own = _scope_location(user)
    location = None
    if not problems:
        try:
            location = _check_recruiters(session, [r.id for r in recruiters], own) if recruiters else None
            for person, label in ((manager, "recruitment manager"), (sales, "sales manager")):
                if person is not None:
                    _check_manager(session, person.id, own, person.role, label)
                    if location and person.location != location:
                        raise HTTPException(status_code=422, detail=f"the {label} works in {person.location}, the recruiters in {location}")
                    location = location or person.location
        except HTTPException as exc:
            problems.append(str(exc.detail))
        location = own or location

    if (count is not None or cvs_date) and not recruiters:
        notes.append("CVs submitted are not kept: nobody is assigned to record them against")

    outcome = "error" if problems else "import"
    if problems:
        notes = []                              # adjustments only matter for a row that will be imported
    if outcome == "import":
        key = (position.lower(), client.lower(), req_date)
        exists = session.exec(select(Requirement.id).where(func.lower(Requirement.position) == key[0], func.lower(Requirement.client) == key[1],
                                                           Requirement.requirement_date == req_date).limit(1)).first()
        if exists or key in seen:
            outcome = "exists"
        seen.add(key)
    return {
        "row": raw["row"], "outcome": outcome, "problems": problems, "notes": notes,
        "position": position, "client": client, "requirement_date": req_date.isoformat() if req_date else None,
        "status": status_value, "recruiters": [r.username for r in recruiters], "missing": missing,
        "sheet": {"recruiters": sheet_recruiters, "manager": sheet_people["manager"], "sales_manager": sheet_people["sales"]},
        "manager": manager.username if manager else None, "sales_manager": sales.username if sales else None,
        "cvs_submitted_date": cvs_date.isoformat() if cvs_date else None, "cvs_submitted_count": count, "comments": comments,
        "_ids": {"recruiters": [r.id for r in recruiters], "manager": manager.id if manager else None, "sales": sales.id if sales else None,
                 "location": location, "req_date": req_date, "cvs_date": cvs_date},
    }


def _create(session: Session, user: User, plan: Dict[str, Any]) -> Requirement:
    ids = plan["_ids"]
    closed = plan["status"] == "closed"
    closed_on = ids["cvs_date"] or ids["req_date"]
    credited = plan["recruiters"][0] if plan["recruiters"] else None
    req = Requirement(
        location=ids["location"], requirement_date=ids["req_date"], position=plan["position"], client=plan["client"],
        recruiter_comments=plan["comments"], manager_id=ids["manager"],
        sales_manager_id=ids["sales"] if ids["sales"] else (user.id if user.role == "account_manager" else None),
        status=plan["status"], created_by=user.username, updated_by=user.username,
        # a closed row: closed on the day its CVs were submitted (or its requirement date), credited to its recruiter
        closed_at=datetime.combine(closed_on, time(12, 0)) if closed else None,
        closed_by=(credited or user.username) if closed else None,
    )
    session.add(req)
    session.flush()
    _set_assignees(session, req, ids["recruiters"])
    if ids["recruiters"] and (plan["cvs_submitted_count"] is not None or ids["cvs_date"]):
        link = session.get(RequirementRecruiter, (req.id, ids["recruiters"][0]))
        link.cvs_submitted_date, link.cvs_submitted_count = ids["cvs_date"], plan["cvs_submitted_count"]
        session.add(link)
    _event(session, req, user, "created", "import", None, f"sheet row {plan['row']}")
    if closed:
        create_for_closed(session, req, ids["recruiters"][:1])
    return req


@router.get("/requirements/import/template")
def import_template(user: User = Depends(require_core_app)):
    """The Excel template: the exact column names and two example rows."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    _require_full(user, "import requirements")
    wb = Workbook()
    ws = wb.active
    ws.title = "Requirements"
    ws.append(list(OPTIONAL_COLUMNS) + list(COLUMNS))
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="16204B")
    for row in EXAMPLE_ROWS:
        ws.append(row)
    for col, width in zip("ABCDEFGHIJK", (6, 26, 20, 18, 18, 18, 16, 16, 20, 12, 40)):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "A2"
    out = io.BytesIO()
    wb.save(out)
    return Response(out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="requirements-import-template.xlsx"', "Cache-Control": "no-store"})


@router.get("/requirements/import/columns")
def import_columns(user: User = Depends(require_core_app)):
    """The column names a sheet must have, and the example rows, for the import screen."""
    _require_full(user, "import requirements")
    return {"columns": list(COLUMNS), "optional": list(OPTIONAL_COLUMNS), "example_rows": EXAMPLE_ROWS}


@router.post("/requirements/import")
async def import_requirements(
    file: UploadFile = File(...),
    apply: bool = Query(False, description="false: only say what would happen; true: import the rows that are fine"),
    user: User = Depends(require_core_app),
    session: Session = Depends(get_session),
):
    _require_full(user, "import requirements")
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose an Excel file (.xlsx).")
    data = await read_limited(file, MAX_IMPORT_BYTES)
    if not data.startswith(b"PK"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This is not an Excel (.xlsx) file that can be read.")
    rows, unknown = _read_sheet(data)
    people = People(session)
    seen: set = set()
    plans = [_plan_row(r, session, user, people, seen) for r in rows]
    created = 0
    if apply:
        for plan in plans:
            if plan["outcome"] == "import":
                _create(session, user, plan)
                created += 1
        session.commit()
        security_event("requirements_imported", by=user.username, rows=len(plans), created=created)
    count = lambda o: sum(1 for p in plans if p["outcome"] == o)
    # every login that is missing, once, with how many rows wait for it (the first thing to fix)
    needed: Dict[Tuple[str, str], int] = {}
    for p in plans:
        for m in {(m["name"], m["role"]) for m in p["missing"]}:
            needed[m] = needed.get(m, 0) + 1
    return {
        "applied": apply, "created": created, "ignored_columns": unknown,
        "summary": {"rows": len(plans), "import": count("import"), "exists": count("exists"), "error": count("error"),
                    "with_notes": sum(1 for p in plans if p["notes"])},
        "missing_logins": [{"name": n, "role": r, "rows": c} for (n, r), c in sorted(needed.items(), key=lambda x: (-x[1], x[0]))],
        "rows": [{k: v for k, v in p.items() if k != "_ids"} for p in plans],
    }
