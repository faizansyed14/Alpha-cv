"""Requirements tracker, write side: PROPOSE a new requirement, a change to one that exists (including closing or reopening it and writing
its comments or CVs submitted), or a change to a selection. Like every ``propose_*`` tool nothing is changed here: the tool checks what the
person asked for against THEIR role, reads what it needs to show the before and after, and puts a card with Confirm and Cancel on screen.
The change is made only after they confirm, by ``actions/catalog.py`` through the application's own endpoint, which checks the role again.

There is no tool that deletes a requirement or a selection, and none can be added (the gateway has no DELETE).
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from app.agentic.actions import flow
from app.agentic.guardrails.output_guard import safe_text
from app.agentic.tools.base import Tool, ToolContext, ToolError, ToolOutput, obj, text
from app.agentic.tools.tracker import (CORE, SELECTION, SELECTION_STATUSES, STATUSES, iso_day, normalise_selection_status, normalise_status, person_id)
from app.security.rbac_rules import REQUIREMENT_FIELD_EDITORS, SELECTION_FIELD_EDITORS, TRACKER_FULL_ROLES

FULL = frozenset(TRACKER_FULL_ROLES)
MAX_COMMENT = 4000
STATUS_LABEL = {"offer_pending": "Offer Pending", "offer_released": "Offer Released", "joined": "Joined", "backed_out": "Backed Out"}
FIELD_LABEL = {
    "position": "Position", "client": "Client", "requirement_date": "Requirement date", "cv_submission_date": "Submission deadline", "job_location": "Job location",
    "salary": "Salary", "duration": "Job duration", "recruiter": "Recruiters", "recruitment_manager": "Recruitment manager", "sales_manager": "Sales manager",
    "status": "Status", "sales_comments": "Sales manager comments", "rm_comments": "Recruitment manager comments", "recruiter_comments": "Recruiter comments",
    "cvs_submitted": "CVs submitted",
}
ROLE_NAMES = {"user": "recruiter", "manager": "recruitment manager", "account_manager": "sales manager", "evp": "EVP", "admin": "admin"}


# ---------------------------------------------------------------------------------------------------------- helpers
def _allowed(ctx: ToolContext, key: str) -> None:
    """The person's role may change this field (the same table the Requirements page and the server use), else a clear refusal."""
    editors = REQUIREMENT_FIELD_EDITORS.get(key)
    if editors is not None and ctx.role not in editors:
        raise ToolError(f"A {ROLE_NAMES.get(ctx.role, ctx.role)} cannot change the {FIELD_LABEL.get(key, key).lower()}.")


def merge_comment(before: str, new: str, mode: str) -> str:
    """Comments are one box per role: by default the new text is added after what is there, and only 'replace' overwrites it."""
    new = str(new or "").strip()
    before = str(before or "").strip()
    return new if (mode == "replace" or not before) else f"{before}\n\n{new}"


def _duration(args: Dict[str, Any]) -> Dict[str, Any]:
    kind = text(args.get("duration_type"), 12).lower().replace(" ", "_").replace("-", "_")
    if not kind and not args.get("duration_value"):
        return {}
    if kind in ("fulltime", "full_time", "permanent"):
        return {"duration_type": "full_time"}
    if kind in ("", "fixed", "contract"):
        value = args.get("duration_value")
        unit = text(args.get("duration_unit"), 8).lower()
        unit = unit if unit.endswith("s") else unit + "s"
        if not value or unit not in ("days", "months", "years"):
            raise ToolError("A fixed job duration needs a number (1 to 31) and days, months or years. Ask for them, or say full time.")
        body = {"duration_type": "fixed", "duration_value": int(value), "duration_unit": unit}
        if isinstance(args.get("duration_extendable"), bool):
            body["duration_extendable"] = args["duration_extendable"]
        return body
    raise ToolError("The job duration is either full time or a fixed number of days, months or years.")


def _duration_text(d: Dict[str, Any]) -> str:
    if d.get("duration_type") == "full_time":
        return "Full time"
    if d.get("duration_type") == "fixed":
        return f"{d.get('duration_value')} {d.get('duration_unit')}" + (", may be extended" if d.get("duration_extendable") else "")
    return ""


def _current_duration(v: Dict[str, Any]) -> str:
    return _duration_text({k: v.get(k) for k in ("duration_type", "duration_value", "duration_unit", "duration_extendable")})


def _names(items: Any) -> str:
    return ", ".join(text(x.get("username"), 40) for x in (items or []) if isinstance(x, dict))


def _view(row: Tuple[str, Any, Any]) -> Tuple[str, str]:
    label, old, new = row
    shown = text(new, 300) or "(empty)"
    return label, f"{text(old, 140) or '(empty)'}  ->  {shown}"


# ----------------------------------------------------------------------------------------------- a new requirement
def propose_requirement_create(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    position, client = text(args.get("position"), 160), text(args.get("client"), 160)
    if not position or not client:
        raise ToolError("A requirement needs a position and a client. Ask for the missing one.")
    body: Dict[str, Any] = {"position": position, "client": client, "requirement_date": iso_day(args.get("requirement_date"), "The requirement date") or date.today().isoformat()}
    for arg in ("job_location", "salary"):
        if text(args.get(arg), 160):
            body[arg] = text(args[arg], 160 if arg == "job_location" else 64)
            _allowed(ctx, arg)
    deadline = iso_day(args.get("cv_submission_date"), "The submission deadline")
    if deadline:
        body["cv_submission_date"] = deadline
        if deadline < body["requirement_date"]:
            raise ToolError("The submission deadline cannot be before the requirement date.")
    duration = _duration(args)
    if duration:
        _allowed(ctx, "duration")
        body.update(duration)
    cache: Dict[str, Any] = {}
    rows: List[Tuple[str, Any]] = [("Position", position), ("Client", client), ("Requirement date", body["requirement_date"]), ("Submission deadline", deadline),
                                   ("Job location", body.get("job_location")), ("Salary", body.get("salary")), ("Job duration", _duration_text(duration))]
    recruiters = [text(n, 60) for n in (args.get("recruiters") or []) if text(n, 60)][:10]
    if recruiters:
        _allowed(ctx, "recruiter")
        body["recruiter_ids"] = [person_id(ctx, "recruiter", n, "recruiter", cache) for n in recruiters]
        rows.append(("Recruiters", ", ".join(recruiters)))
    if text(args.get("recruitment_manager"), 60):
        _allowed(ctx, "recruitment_manager")
        body["manager_id"] = person_id(ctx, "manager", args["recruitment_manager"], "recruitment manager", cache)
        rows.append(("Recruitment manager", text(args["recruitment_manager"], 60)))
    if text(args.get("sales_manager"), 60):
        _allowed(ctx, "sales_manager")
        body["sales_manager_id"] = person_id(ctx, "sales_manager", args["sales_manager"], "sales manager", cache)
        rows.append(("Sales manager", text(args["sales_manager"], 60)))
    elif ctx.role == "account_manager":
        rows.append(("Sales manager", "You (added by you)"))
    for arg in ("sales_comments", "rm_comments", "recruiter_comments"):
        if str(args.get(arg) or "").strip():
            _allowed(ctx, arg)
            body[arg] = str(args[arg]).strip()[:MAX_COMMENT]
            rows.append((FIELD_LABEL[arg], safe_text(body[arg], 300)))
    return flow.propose(ctx, "requirement.create", rows, {"body": body, "title": f"{position} for {client}"}, title="Add this requirement",
                        warning="")


# ------------------------------------------------------------------------------------- a change to one that exists
def _current(ctx: ToolContext, requirement_id: str) -> Dict[str, Any]:
    return ctx.gateway.get(f"/api/tracker/requirements/{requirement_id}")          # also the visibility rule: one the person may not see is "not found"


def propose_requirement_update(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    rid = text(args.get("requirement_id"), 60)
    if not rid:
        raise ToolError("requirement_id is required. Find the requirement with list_requirements first.")
    cur = _current(ctx, rid)
    body: Dict[str, Any] = {}
    changes: List[Tuple[str, Any, Any]] = []
    cache: Dict[str, Any] = {}

    def simple(arg: str, key: str, old: Any, clean) -> None:
        if arg in args and args[arg] is not None:
            _allowed(ctx, key)
            new = clean(args[arg])
            if (new or None) != (old or None):
                body[arg] = new or None
                changes.append((FIELD_LABEL[key], old, new))

    simple("position", "position", cur.get("position"), lambda v: text(v, 160))
    simple("client", "client", cur.get("client"), lambda v: text(v, 160))
    simple("job_location", "job_location", cur.get("job_location"), lambda v: text(v, 160))
    simple("salary", "salary", cur.get("salary"), lambda v: text(v, 64))
    simple("requirement_date", "requirement_date", cur.get("requirement_date"), lambda v: iso_day(v, "The requirement date"))
    simple("cv_submission_date", "cv_submission_date", cur.get("cv_submission_date"), lambda v: iso_day(v, "The submission deadline"))
    duration = _duration(args)
    if duration:
        _allowed(ctx, "duration")
        if duration != {k: cur.get(k) for k in duration}:
            body.update(duration)
            changes.append((FIELD_LABEL["duration"], _current_duration(cur), _duration_text(duration)))

    reopening = closing = False
    if args.get("status"):
        _allowed(ctx, "status")
        new_status = normalise_status(args["status"])
        if new_status != cur.get("status"):
            body["status"] = new_status
            changes.append((FIELD_LABEL["status"], cur.get("status"), new_status))
            closing, reopening = new_status == "closed", cur.get("status") == "closed" and new_status != "closed"

    if args.get("recruiters") is not None:
        _allowed(ctx, "recruiter")
        names = [text(n, 60) for n in (args.get("recruiters") or []) if text(n, 60)][:10]
        ids = [person_id(ctx, "recruiter", n, "recruiter", cache) for n in names]
        if ids != [r.get("id") for r in cur.get("recruiters") or []]:
            body["recruiter_ids"] = ids
            changes.append((FIELD_LABEL["recruiter"], _names(cur.get("recruiters")), ", ".join(names) or "(nobody)"))
    for arg, key, kind, label, current_key in (("recruitment_manager", "recruitment_manager", "manager", "recruitment manager", "manager"),
                                               ("sales_manager", "sales_manager", "sales_manager", "sales manager", "sales_manager")):
        if arg in args and args[arg] is not None:
            _allowed(ctx, key)
            wanted = text(args[arg], 60)
            field = "manager_id" if kind == "manager" else "sales_manager_id"
            if not wanted or wanted.lower() in ("none", "nobody", "unassigned"):
                if (cur.get(current_key) or {}).get("id"):
                    body[field] = None
                    changes.append((FIELD_LABEL[key], _names([cur.get(current_key)]), "(nobody)"))
            else:
                new_id = person_id(ctx, kind, wanted, label, cache)
                if new_id != (cur.get(current_key) or {}).get("id"):
                    body[field] = new_id
                    changes.append((FIELD_LABEL[key], _names([cur.get(current_key)]) or "(nobody)", wanted))

    mode = text(args.get("comments_mode"), 10).lower()
    for arg in ("sales_comments", "rm_comments", "recruiter_comments"):
        if str(args.get(arg) or "").strip():
            _allowed(ctx, arg)
            final = merge_comment(cur.get(arg), args[arg], mode)[:MAX_COMMENT]
            if final != (cur.get(arg) or ""):
                body[arg] = final
                changes.append((FIELD_LABEL[arg], safe_text(cur.get(arg), 120), safe_text(str(args[arg]).strip(), 200)))

    if args.get("cvs_submitted_count") is not None or args.get("cvs_submitted_date"):
        _allowed(ctx, "cvs_submitted")
        mine = [r for r in cur.get("recruiters") or []]
        who = text(args.get("cvs_recruiter"), 60).lower()
        if ctx.role == "user":
            target = next((r for r in mine if str(r.get("username") or "").lower() == ctx.username.lower()), None)
        elif who:
            target = next((r for r in mine if who in str(r.get("username") or "").lower()), None)
        else:
            target = mine[0] if len(mine) == 1 else None
        if target is None:
            raise ToolError("Say which of the assigned recruiters these CVs belong to: " + (_names(mine) or "nobody is assigned yet") + ".")
        item: Dict[str, Any] = {"recruiter_id": target["id"]}
        if args.get("cvs_submitted_count") is not None:
            try:
                count = int(args["cvs_submitted_count"])
            except (TypeError, ValueError):
                raise ToolError("The number of CVs submitted must be a whole number.")
            if not 0 <= count <= 100000:
                raise ToolError("The number of CVs submitted must be between 0 and 100,000.")
            item["count"] = count
        if args.get("cvs_submitted_date"):
            item["date"] = iso_day(args["cvs_submitted_date"], "The CVs submitted date")
        body["cvs_submissions"] = [item]
        changes.append((f"{FIELD_LABEL['cvs_submitted']} ({text(target.get('username'), 40)})",
                        f"{target.get('cvs_submitted_count') if target.get('cvs_submitted_count') is not None else '-'} on {target.get('cvs_submitted_date') or '-'}",
                        f"{item.get('count', target.get('cvs_submitted_count') if target.get('cvs_submitted_count') is not None else '-')} on {item.get('date', target.get('cvs_submitted_date') or '-')}"))

    if not changes:
        raise ToolError("Nothing would change: it already has those values, or you did not say what to change.")
    title = f"{safe_text(cur.get('position'), 70)} for {safe_text(cur.get('client'), 50)}"
    warning = ""
    if closing:
        warning = "Closing it moves it to the Closures page and adds a row on Selections and joining."
    elif reopening:
        warning = "Reopening it puts it back on the Requirements page. Its Selections and joining row is kept."
    rows = [("Requirement", title)] + [_view(c) for c in changes]
    return flow.propose(ctx, "requirement.update", rows, {"requirement_id": rid, "body": body, "title": title},
                        title="Close this requirement" if closing else "Reopen this requirement" if reopening else "Update this requirement", warning=warning)


# ---------------------------------------------------------------------------------- selections and joining
def propose_selection_update(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    sid = text(args.get("selection_id"), 60)
    if not sid:
        raise ToolError("selection_id is required. Find the selection with list_selections first.")
    cur = ctx.gateway.get(f"/api/tracker/selections/{sid}")
    body: Dict[str, Any] = {}
    changes: List[Tuple[str, Any, Any]] = []
    if args.get("candidate_name") is not None:
        new = text(args["candidate_name"], 160)
        if (new or None) != (cur.get("candidate_name") or None):
            body["candidate_name"] = new or None
            changes.append(("Candidate", cur.get("candidate_name"), new))
    if args.get("status"):
        new = normalise_selection_status(args["status"])
        if new != cur.get("status"):
            body["status"] = new
            changes.append(("Status", STATUS_LABEL.get(cur.get("status"), cur.get("status")), STATUS_LABEL[new]))
    if str(args.get("comments") or "").strip():
        final = merge_comment(cur.get("comments"), args["comments"], text(args.get("comments_mode"), 10).lower())[:MAX_COMMENT]
        if final != (cur.get("comments") or ""):
            body["comments"] = final
            changes.append(("Comments", safe_text(cur.get("comments"), 120), safe_text(str(args["comments"]).strip(), 200)))
    if args.get("date"):
        new = iso_day(args["date"], "The date")
        if new != cur.get("date"):
            body["selection_date"] = new
            changes.append(("Date", cur.get("date"), new))
    if not changes:
        raise ToolError("Nothing would change: it already has those values, or you did not say what to change.")
    title = f"{safe_text(cur.get('position'), 70)} for {safe_text(cur.get('client'), 50)}"
    return flow.propose(ctx, "selection.update", [("Selection", title)] + [_view(c) for c in changes], {"selection_id": sid, "body": body, "title": title},
                        title="Update this selection")


_COMMENT_PROPS = {"sales_comments": {"type": "string", "description": "Sales manager comments (sales manager, EVP, admin)."},
                  "rm_comments": {"type": "string", "description": "Recruitment manager comments (recruitment manager, EVP, admin)."},
                  "recruiter_comments": {"type": "string", "description": "Recruiter comments (recruiter, EVP, admin)."},
                  "comments_mode": {"type": "string", "enum": ["append", "replace"], "description": "append (default) adds after the comment that is there; replace overwrites it."}}
_DETAIL_PROPS = {"job_location": {"type": "string"}, "salary": {"type": "string"}, "requirement_date": {"type": "string", "description": "YYYY-MM-DD"},
                 "cv_submission_date": {"type": "string", "description": "The submission deadline, YYYY-MM-DD."},
                 "duration_type": {"type": "string", "enum": ["full_time", "fixed"]}, "duration_value": {"type": "integer", "description": "1 to 31, for fixed."},
                 "duration_unit": {"type": "string", "enum": ["days", "months", "years"]}, "duration_extendable": {"type": "boolean"},
                 "recruiters": {"type": "array", "items": {"type": "string"}, "description": "Recruiter names, the first is the lead. Replaces the list."},
                 "recruitment_manager": {"type": "string"}, "sales_manager": {"type": "string"}}

TOOLS = [
    Tool("propose_requirement_create", "Add a new requirement (shown for confirmation first). Needs a position and a client; the date defaults to today. "
         "Sales manager, recruitment manager, EVP and admin only.",
         obj(position={"type": "string"}, client={"type": "string"}, **_DETAIL_PROPS, **_COMMENT_PROPS, required=["position", "client"]), FULL, propose_requirement_create, writes=True),
    Tool("propose_requirement_update", "Change a requirement that exists (shown as before and after, for confirmation first): its details, people, dates, comments, "
         "CVs submitted, or its status (open, submitted, hold, closed, canceled; closing moves it to Closures and Selections and joining, reopening brings it back). "
         "Each role can change only its own fields: the tool says so when it cannot.",
         obj(requirement_id={"type": "string"}, position={"type": "string"}, client={"type": "string"}, status={"type": "string", "enum": list(STATUSES)},
             cvs_submitted_count={"type": "integer", "description": "How many CVs the recruiter has submitted."}, cvs_submitted_date={"type": "string", "description": "YYYY-MM-DD"},
             cvs_recruiter={"type": "string", "description": "Whose CVs, when it is not the person themselves or the only recruiter."},
             **_DETAIL_PROPS, **_COMMENT_PROPS, required=["requirement_id"]), CORE, propose_requirement_update, writes=True),
    Tool("propose_selection_update", "Change a selection on the Selections and joining page (shown for confirmation first): the candidate who was selected, the status "
         "(Offer Pending, Offer Released, Joined, Backed Out), the comments or the date. Not available to recruiters.",
         obj(selection_id={"type": "string"}, candidate_name={"type": "string"},
             status={"type": "string", "description": "Offer Pending, Offer Released, Joined or Backed Out."}, comments={"type": "string"},
             comments_mode={"type": "string", "enum": ["append", "replace"]}, date={"type": "string", "description": "YYYY-MM-DD"}, required=["selection_id"]),
         SELECTION, propose_selection_update, writes=True),
]
