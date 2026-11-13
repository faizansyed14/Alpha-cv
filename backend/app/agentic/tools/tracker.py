"""Requirements tracker, read side: requirements, closures, one requirement's details and history, analytics, and selections and joining.

Everything is read through the application's own tracker endpoints as the signed-in person, so the same rules apply as on the pages: a
recruiter sees only the requirements assigned to them, a recruitment manager or sales manager their own location, the EVP and the admin
both locations, and selections and joining is not available to recruiters at all (the tool is not even offered to them). Lists
are drawn on screen only when the person asked to see them, a page at a time (``pages.py``).
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from app.agentic.guardrails.output_guard import safe_text
from app.agentic.tools import pages
from app.agentic.tools.base import Tool, ToolContext, ToolError, ToolOutput, number, obj, text
from app.security.rbac_rules import ALL_ROLES, LOCATIONS, SELECTION_ROLES

CORE = frozenset(ALL_ROLES)
SELECTION = frozenset(SELECTION_ROLES)

STATUSES = ("open", "submitted", "hold", "closed", "canceled")
SELECTION_STATUSES = ("offer_pending", "offer_released", "joined", "backed_out")
_SELECTION_WORDS = (("offer_released", ("released",)), ("offer_pending", ("pending",)), ("backed_out", ("back", "backout", "backed", "withdr", "declin", "reject")),
                    ("joined", ("join",)))


# ------------------------------------------------------------------------------------------------------- names -> ids
def tracker_people(ctx: ToolContext) -> Dict[str, List[Dict[str, Any]]]:
    """Who can be named: the recruiters, recruitment managers and sales managers the person's role may pick (their own location; the EVP and
    the admin: both). Recruiters get none: they cannot assign anyone."""
    options = ctx.gateway.get("/api/tracker/options")
    return {"recruiter": list(options.get("recruiters") or []), "manager": list(options.get("managers") or []),
            "sales_manager": list(options.get("sales_managers") or [])}


def pick_person(people: List[Dict[str, Any]], name: str, label: str) -> Dict[str, Any]:
    """The one person this name means: an exact username, else a name that starts with it, else one that contains it. Two or none is an error
    that says who there is, so the assistant can ask."""
    wanted = text(name, 60).lower()
    if not wanted:
        raise ToolError(f"Say which {label}.")
    for test in (lambda u: u == wanted, lambda u: u.startswith(wanted), lambda u: wanted in u):
        hits = [p for p in people if test(str(p.get("username") or "").lower())]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            raise ToolError(f"More than one {label} fits '{name}': " + ", ".join(text(p.get("username"), 30) for p in hits[:6]) + ". Ask which one.")
    known = ", ".join(text(p.get("username"), 30) for p in people[:8])
    raise ToolError(f"There is no {label} called '{name}' that you can choose." + (f" The choices are: {known}." if known else ""))


def person_id(ctx: ToolContext, kind: str, name: str, label: str, cache: Dict[str, Any]) -> str:
    if "people" not in cache:
        cache["people"] = tracker_people(ctx)
    return str(pick_person(cache["people"][kind], name, label)["id"])


def normalise_selection_status(value: Any) -> str:
    raw = text(value, 40).lower().replace("-", " ").replace("_", " ")
    if not raw:
        return ""
    for status, words in _SELECTION_WORDS:
        if any(w in raw for w in words):
            return status
    raise ToolError("The status must be one of: Offer Pending, Offer Released, Joined, Backed Out.")


def normalise_status(value: Any) -> str:
    raw = text(value, 20).lower()
    aliases = {"cancelled": "canceled", "on hold": "hold", "closed": "closed", "close": "closed", "reopen": "open", "reopened": "open"}
    raw = aliases.get(raw, raw)
    if raw not in STATUSES:
        raise ToolError("The status must be one of: open, submitted, hold, closed, canceled.")
    return raw


def normalise_location(value: Any) -> str:
    raw = text(value, 30).lower().replace(" ", "")
    for place in LOCATIONS:
        if place.lower().replace(" ", "") == raw:
            return place
    if raw:
        raise ToolError("The location must be Dubai or Abu Dhabi.")
    return ""


def iso_day(value: Any, label: str) -> str:
    raw = text(value, 12)
    if not raw:
        return ""
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError:
        raise ToolError(f"{label} must be a date like 2026-11-30.")


def _filters(ctx: ToolContext, args: Dict[str, Any], with_selection_filters: bool = False) -> Dict[str, Any]:
    """The names in the arguments turned into the ids the endpoints filter by. Recruiters are already held to their own requirements by the
    server, so they cannot (and need not) filter by person."""
    keep: Dict[str, Any] = {"query": text(args.get("query"), 80)}
    if args.get("status"):
        keep["status"] = normalise_selection_status(args["status"]) if with_selection_filters else normalise_status(args["status"])
    if args.get("location"):
        keep["location"] = normalise_location(args["location"])
    cache: Dict[str, Any] = {}
    if ctx.role != "user":
        if args.get("recruiter"):
            keep["recruiter_id"] = person_id(ctx, "recruiter", args["recruiter"], "recruiter", cache)
        if not with_selection_filters and args.get("recruitment_manager"):
            keep["manager_id"] = person_id(ctx, "manager", args["recruitment_manager"], "recruitment manager", cache)
        if not with_selection_filters and args.get("sales_manager"):
            keep["sales_manager_id"] = person_id(ctx, "sales_manager", args["sales_manager"], "sales manager", cache)
    return {k: v for k, v in keep.items() if v not in (None, "")}


def _names(rows: List[Dict[str, Any]], key: str) -> str:
    return "; ".join(f"{r.get(key)} (id={r.get('id')})" for r in rows[:pages.MODEL_ROWS])


# ------------------------------------------------------------------------------------------------------------- tools
def list_requirements(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    """The open requirements (closed ones are on the closures list), with filters. Drawn on screen only when the person asked to see them."""
    keep = _filters(ctx, args)
    page = pages.requirements_page(ctx.gateway, limit=number(args.get("limit"), pages.PAGE, 1, 25), **keep)
    ctx.see(*(r["id"] for r in page.rows))
    card = {"type": "requirements", "rows": page.rows, "total": page.total, "stats": page.stats, "page": pages.descriptor("list_requirements", keep, page)} if ctx.show_lists else None
    model = pages.for_model(page.rows, ["id", "position", "client", "status", "recruiters", "manager", "sales_manager", "date", "deadline", "cvs"], page.total, bool(card))
    if page.stats:
        model["counts"] = {k: page.stats.get(k) for k in ("total", "open", "submitted", "hold", "canceled", "closed")}
    out = ToolOutput(model, card, f"Requirements found: {page.total}; top: {_names(page.rows, 'position')}"[:700])
    out.choices = None if card else [f"{r['position']} for {r['client']}" for r in page.rows[:6]] if 2 <= len(page.rows) <= 6 else None
    return out


def _closures_range(args: Dict[str, Any]) -> Dict[str, Any]:
    year = number(args.get("year"), 0, 0, 2100)
    month = number(args.get("month"), 0, 0, 12)
    keep: Dict[str, Any] = {}
    if year:
        keep["year"] = year
        if month:
            keep["month"] = month
    elif month:
        keep["year"], keep["month"] = date.today().year, month
    return keep


def list_closures(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    keep = {**_filters(ctx, args), **_closures_range(args)}
    keep.pop("status", None)
    page = pages.closures_page(ctx.gateway, limit=number(args.get("limit"), pages.PAGE, 1, 25), **keep)
    ctx.see(*(r["id"] for r in page.rows))
    card = {"type": "closures", "rows": page.rows, "total": page.total, "summary": page.stats, "page": pages.descriptor("list_closures", keep, page)} if ctx.show_lists else None
    model = pages.for_model(page.rows, ["id", "position", "client", "recruiters", "manager", "sales_manager", "closed", "days"], page.total, bool(card))
    if page.stats:
        model["summary"] = page.stats
    return ToolOutput(model, card, f"Closures found: {page.total}; top: {_names(page.rows, 'position')}"[:700])


def get_requirement(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    rid = text(args.get("requirement_id"), 60)
    if not rid:
        raise ToolError("requirement_id is required. List the requirements first.")
    v = ctx.gateway.get(f"/api/tracker/requirements/{rid}")
    ctx.see(rid)
    row = pages.requirement_row(v)
    history = [f"{text(e.get('at'), 10)} {text(e.get('actor'), 30)}: {text(e.get('field'), 30) or e.get('action')}"
               + (f" {safe_text(e.get('old'), 60)} -> {safe_text(e.get('new'), 60)}" if e.get("field") else "") for e in (v.get("history") or [])[:8]]
    comments = {k: safe_text(v.get(k), 300) for k in ("sales_comments", "rm_comments", "recruiter_comments") if v.get(k)}
    facts = [("Status", row["status"]), ("Recruiters", row["recruiters"]), ("Recruitment manager", row["manager"]), ("Sales manager", row["sales_manager"]),
             ("Requirement date", row["date"]), ("Submission deadline", row["deadline"]), ("CVs submitted", row["cvs"]), ("Job location", row["job_location"]),
             ("Salary", text(v.get("salary"), 60) or None), ("Closed", row["closed"])]
    card = {"type": "table", "title": f"{row['position']} for {row['client']}",
            "rows": [{"field": k, "value": val} for k, val in facts if val not in (None, "")] + [{"field": "Recent change", "value": h} for h in history[:5]]}
    return ToolOutput({"requirement": {**row, "comments": comments}, "history": history}, card, f"Requirement read: {row['position']} for {row['client']} (id={rid})")


def tracker_analytics(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    view = text(args.get("view"), 10).lower() or "monthly"
    if view not in ("monthly", "yearly"):
        raise ToolError("view must be monthly or yearly.")
    today = date.today()
    year = number(args.get("year"), today.year, 2000, 2100)
    params: Dict[str, Any] = {"view": view, "year": year}
    if view == "monthly":
        params["month"] = number(args.get("month"), today.month, 1, 12)
    location = normalise_location(args.get("location"))
    if location:
        params["location"] = location
    body = ctx.gateway.get("/api/tracker/analytics", **params)
    s = body.get("summary") or {}
    people = [{"recruiter": text(r.get("username"), 40), **({"location": r.get("location")} if r.get("location") else {}), "closed": r.get("closed"),
               "cvs_submitted": r.get("cvs_submitted"), "open": r.get("open"), "submitted": r.get("submitted"), "hold": r.get("hold"), "canceled": r.get("canceled")}
              for r in (body.get("recruiters") or [])[:12]]
    places = [{"location": p.get("location"), "closed": p.get("closed"), "received": p.get("received"), "recruiters": p.get("recruiters"), "overdue": p.get("overdue")}
              for p in (body.get("locations") or [])]
    summary = {"period": body.get("label"), "scope": body.get("scope"), "received": s.get("received"), "closed": s.get("closed"),
               "previous": {"label": s.get("previous_label"), "received": s.get("previous_received"), "closed": s.get("previous_closed")},
               "avg_days_to_close": s.get("avg_days"), "cvs_submitted": s.get("cvs_submitted"), "open_now": s.get("active"), "canceled_now": s.get("canceled"),
               "overdue": s.get("overdue")}
    title = (f"{body.get('label')}: {s.get('closed', 0)} closed of {s.get('received', 0)} received"
             + (f", average {s.get('avg_days')} days to close" if s.get("avg_days") is not None else ""))
    card = {"type": "table", "title": title, "rows": people} if people else {"type": "table", "title": title, "rows": [{"measure": k, "value": v} for k, v in
            (("Received", s.get("received")), ("Closed", s.get("closed")), ("CVs submitted", s.get("cvs_submitted")), ("Overdue", s.get("overdue")))]}
    return ToolOutput({"summary": summary, "by_location": places, "recruiters": people[:8]}, card, f"Analytics read: {body.get('label')}")


def list_selections(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    keep = _filters(ctx, args, with_selection_filters=True)
    for key in ("date_from", "date_to"):
        if args.get(key):
            keep[key] = iso_day(args[key], key.replace("_", " "))
    page = pages.selections_page(ctx.gateway, limit=number(args.get("limit"), pages.PAGE, 1, 25), **keep)
    ctx.see(*(r["id"] for r in page.rows))
    card = {"type": "selections", "rows": page.rows, "total": page.total, "stats": page.stats, "page": pages.descriptor("list_selections", keep, page)} if ctx.show_lists else None
    model = pages.for_model(page.rows, ["id", "date", "candidate", "position", "client", "status", "recruiters"], page.total, bool(card))
    if page.stats:
        model["counts"] = page.stats
    return ToolOutput(model, card, f"Selections found: {page.total}; top: {_names(page.rows, 'position')}"[:700])


_FILTER_PROPS = {"query": {"type": "string", "description": "Words from the position, client or a person's name."}, "limit": {"type": "integer"},
                 "location": {"type": "string", "description": "Dubai or Abu Dhabi (only the EVP and the admin can choose; others see their own)."}}
_PEOPLE_PROPS = {"recruiter": {"type": "string", "description": "A recruiter's name."}, "recruitment_manager": {"type": "string"}, "sales_manager": {"type": "string"}}

TOOLS = [
    Tool("list_requirements", "List the open requirements this person can see (closed ones are in list_closures), with their recruiters, managers, status and dates. "
         "Filter by words, status, recruiter, recruitment manager, sales manager or location. Shows counts by status.",
         obj(**_FILTER_PROPS, **_PEOPLE_PROPS, status={"type": "string", "enum": list(STATUSES)}), CORE, list_requirements),
    Tool("list_closures", "List closed requirements (who closed them, when, how many days it took). Filter by words, people, location, year and month.",
         obj(**_FILTER_PROPS, **_PEOPLE_PROPS, year={"type": "integer"}, month={"type": "integer", "description": "1 to 12 (needs a year, or means this year)."}), CORE, list_closures),
    Tool("get_requirement", "One requirement in detail with its comments and recent history. Use the id from list_requirements or list_closures.",
         obj(requirement_id={"type": "string"}, required=["requirement_id"]), CORE, get_requirement),
    Tool("tracker_analytics", "Requirements analytics for a month or a year: received, closed, average days to close, CVs submitted, who closed what, open work, "
         "and (EVP, admin) Dubai against Abu Dhabi. A recruiter gets their own numbers.",
         obj(view={"type": "string", "enum": ["monthly", "yearly"]}, year={"type": "integer"}, month={"type": "integer"}, location={"type": "string"}), CORE, tracker_analytics),
    Tool("list_selections", "Selections and joining: the candidates selected for closed requirements and whether the offer is pending or released, they joined or backed out. "
         "Not available to recruiters.",
         obj(**_FILTER_PROPS, recruiter={"type": "string"}, status={"type": "string", "description": "Offer Pending, Offer Released, Joined or Backed Out."},
             date_from={"type": "string", "description": "YYYY-MM-DD"}, date_to={"type": "string", "description": "YYYY-MM-DD"}), SELECTION, list_selections),
]
