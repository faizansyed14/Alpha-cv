"""The kinds of change Agentic mode can make once the person has confirmed them. Each kind is data plus one small function that
calls the application's own endpoint through ``ApiGateway.act``. There is deliberately no kind that deletes, removes or resets."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable, Dict, FrozenSet, Tuple

from app.agentic import uploads
from app.agentic.tools.base import ToolError, text
from app.agentic.tools.gateway import ApiGateway

CORE = frozenset({"admin", "user", "manager", "evp"})
TRACKER_ALL = CORE | {"account_manager"}
TRACKER_MANAGE = frozenset({"manager", "account_manager"})
ADMIN = frozenset({"admin"})

_ID = re.compile(r"^[\w-]{8,64}$")
_CV_ID = re.compile(r"^[0-9a-fA-F-]{32,40}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The fields the tracker accepts, per resource: (field, kind, max length). Anything else is dropped before it is proposed.
TRACKER_FIELDS: Dict[str, Tuple[Tuple[str, str, int], ...]] = {
    "follow-ups": (("client_name", "str", 300), ("position", "str", 300), ("recruiter_name", "str", 300), ("account_manager", "str", 300),
                   ("recruitment_manager", "str", 300), ("cv_submitted_date", "date", 10), ("current_stage", "str", 50),
                   ("last_follow_up_date", "date", 10), ("next_follow_up_date", "date", 10), ("interview_date", "date", 10),
                   ("client_feedback", "str", 4000), ("interview_feedback", "str", 4000), ("remarks", "str", 4000)),
    "job-openings": (("title", "str", 300), ("department", "str", 200), ("client", "str", 200), ("status", "str", 50), ("hiring_manager", "str", 200),
                     ("recruitment_manager", "str", 200), ("req_date", "date", 10), ("submission_date", "date", 10), ("cvs_submitted_count", "int", 100000),
                     ("comments", "str", 4000)),
    "candidates": (("name", "str", 300), ("email", "str", 300), ("phone", "str", 50)),
    "applications": (("candidate_id", "id", 64), ("job_opening_id", "id", 64), ("applied_date", "date", 10), ("position", "str", 300), ("client", "str", 300),
                     ("status", "str", 100), ("recruiter", "str", 100), ("account_manager", "str", 100), ("recruitment_manager", "str", 100),
                     ("comment", "str", 2000)),
}
TRACKER_WRITERS: Dict[str, FrozenSet[str]] = {"follow-ups": TRACKER_ALL, "job-openings": TRACKER_MANAGE, "candidates": TRACKER_MANAGE, "applications": TRACKER_MANAGE}
TRACKER_LABEL = {"follow-ups": "follow-up", "job-openings": "job opening", "candidates": "tracker candidate", "applications": "tracker application"}
JOB_FIELDS = ("job_title", "job_location", "job_summary", "key_responsibilities", "qualifications")


def clean_fields(resource: str, raw: Any) -> Dict[str, Any]:
    """Keep only fields the tracker knows, with the right type and size. Raises ToolError with what is wrong."""
    if resource not in TRACKER_FIELDS:
        raise ToolError("Unknown tracker area. Use follow-ups, job-openings, candidates or applications.")
    if not isinstance(raw, dict) or not raw:
        raise ToolError("Say which details to set.")
    allowed = {name: (kind, size) for name, kind, size in TRACKER_FIELDS[resource]}
    out: Dict[str, Any] = {}
    for key, value in raw.items():
        if key not in allowed or value in (None, ""):
            continue
        kind, size = allowed[key]
        label = key.replace("_", " ")
        if kind == "date":
            try:
                if not _DATE.match(str(value)):
                    raise ValueError
                date.fromisoformat(str(value))
            except ValueError:
                raise ToolError(f"{label} must be a real date written as YYYY-MM-DD.")
            out[key] = str(value)
        elif kind == "int":
            try:
                number = int(value)
            except (TypeError, ValueError):
                raise ToolError(f"{label} must be a whole number.")
            if not 0 <= number <= size:
                raise ToolError(f"{label} must be between 0 and {size}.")
            out[key] = number
        elif kind == "id":
            if not _ID.match(str(value)):
                raise ToolError(f"{label} is not a valid reference. Read the tracker first and use the one shown.")
            out[key] = str(value)
        else:
            out[key] = (" ".join(str(value).split()) if size <= 300 else str(value).strip())[:size]
    if not out:
        raise ToolError("None of those details can be set. They are: " + ", ".join(n.replace("_", " ") for n, _, _ in TRACKER_FIELDS[resource]) + ".")
    return out


@dataclass(frozen=True)
class Action:
    kind: str
    label: str                                   # shown on the card title
    roles: FrozenSet[str]
    run: Callable[[ApiGateway, Dict[str, Any], str], str]      # (gateway, saved payload, username) -> one line saying what was done
    outward: bool = False                        # sends something to other people (an email, a notice): the card says so


# ---------------------------------------------------------------------------------------------------------------- executors
def _note_add(gw: ApiGateway, p: Dict[str, Any], _user: str) -> str:
    if not _CV_ID.match(str(p.get("cv_id") or "")):
        raise ToolError("That candidate could not be identified.")
    gw.act("POST", f"/api/cv/{p['cv_id']}/note", json={"note": str(p.get("note") or "")[:5000]})
    return f"Saved the note on {text(p.get('name'), 80) or 'the candidate'}."


def _job_status(gw: ApiGateway, p: Dict[str, Any], _user: str) -> str:
    if not _ID.match(str(p.get("job_id") or "")):
        raise ToolError("That job could not be identified.")
    body: Dict[str, Any] = {"is_active": bool(p.get("is_active"))}
    if p.get("reason"):
        body["reason"] = text(p.get("reason"), 500)
    gw.act("PATCH", f"/api/careers/admin/jobs/{p['job_id']}/status", json=body)
    return f"{text(p.get('title'), 90) or 'The job'} is now {'open' if body['is_active'] else 'closed'}."


def _job_edit(gw: ApiGateway, p: Dict[str, Any], _user: str) -> str:
    job_id = str(p.get("job_id") or "")
    if not _ID.match(job_id):
        raise ToolError("That job could not be identified.")
    current = gw.act("GET", f"/api/careers/admin/jobs/{job_id}/edit-data")        # the data the Careers edit form loads (and its access rule)
    form = {k: str((current or {}).get(k) or "") for k in JOB_FIELDS}
    for k, v in (p.get("changes") or {}).items():
        if k in JOB_FIELDS and str(v).strip():
            form[k] = str(v).strip()
    missing = [k for k in ("job_title", "job_location", "job_summary", "key_responsibilities", "qualifications") if not form[k].strip()]
    if missing:
        raise ToolError("The job would be missing: " + ", ".join(m.replace("job_", "").replace("_", " ") for m in missing) + ".")
    gw.act("POST", "/api/careers/admin/jobs/unified-update", data={**{k: v for k, v in form.items() if v}, "job_id": job_id})
    return f"Updated {text(form['job_title'], 90)}."


def _tracker_create(gw: ApiGateway, p: Dict[str, Any], _user: str) -> str:
    resource = str(p.get("resource") or "")
    fields = clean_fields(resource, p.get("fields"))
    gw.act("POST", f"/api/tracker/{resource}", json=fields)
    return f"Added the {TRACKER_LABEL[resource]}."


def _tracker_update(gw: ApiGateway, p: Dict[str, Any], _user: str) -> str:
    resource = str(p.get("resource") or "")
    ref = str(p.get("ref") or "")
    if not _ID.match(ref):
        raise ToolError("That row could not be identified. Read the tracker first.")
    gw.act("PATCH", f"/api/tracker/{resource}/{ref}", json=clean_fields(resource, p.get("fields")))
    return f"Updated the {TRACKER_LABEL[resource]}."


def _reminder(gw: ApiGateway, p: Dict[str, Any], _user: str) -> str:
    ref = str(p.get("ref") or "")
    if not _ID.match(ref):
        raise ToolError("That follow-up could not be identified.")
    gw.act("POST", f"/api/tracker/follow-ups/{ref}/send-reminder")
    return "The reminder email was sent."


def _notice(gw: ApiGateway, p: Dict[str, Any], _user: str) -> str:
    message = str(p.get("message") or "").strip()[:4000]
    gw.act("PUT", "/api/admin/notice", json={"message": message, "active": bool(message)})
    return "The notice is now showing for everyone." if message else "The notice is switched off."


def _token_decision(gw: ApiGateway, p: Dict[str, Any], _user: str) -> str:
    decision = str(p.get("decision") or "")
    if decision not in ("approve", "reject") or not _ID.match(str(p.get("request_id") or "")):
        raise ToolError("That request could not be identified.")
    gw.act("POST", f"/api/agents/admin/reset-requests/{p['request_id']}/{decision}")
    return f"{'Approved' if decision == 'approve' else 'Rejected'} the token reset request from {text(p.get('username'), 40)}."


def _library_upload(kind: str) -> Callable[[ApiGateway, Dict[str, Any], str], str]:
    path = "/api/cv/upload-cv" if kind == "cv" else "/api/jd/upload-jd"

    def run(gw: ApiGateway, p: Dict[str, Any], username: str) -> str:
        ref = str(p.get("ref") or "")
        got = uploads.read_bytes(username, ref)
        if got is None:
            raise ToolError("That file is no longer available. Attach it again.")
        data, name, mime = got
        gw.act("POST", path, files={"file": (name, data, mime)}, data={"background_processing": "true"} if kind == "cv" else None)
        uploads.release(username, ref)
        return (f"Added {text(name, 80)} to the CV library. It is being processed and will appear in the database shortly." if kind == "cv"
                else f"Added {text(name, 80)} to the job descriptions.")
    return run


ACTIONS: Dict[str, Action] = {a.kind: a for a in (
    Action("note.add", "Add a note to a candidate", CORE, _note_add),
    Action("job.status", "Open or close a job posting", CORE, _job_status),
    Action("job.edit", "Edit a job posting", CORE, _job_edit),
    Action("tracker.create", "Add to the tracker", TRACKER_ALL, _tracker_create),
    Action("tracker.update", "Update the tracker", TRACKER_ALL, _tracker_update),
    Action("tracker.reminder", "Send a follow-up reminder", TRACKER_ALL, _reminder, outward=True),
    Action("notice.set", "Change the notice shown to everyone", ADMIN, _notice, outward=True),
    Action("tokens.decide", "Answer a token reset request", ADMIN, _token_decision),
    Action("cv.upload", "Add a CV to the library", CORE, _library_upload("cv")),
    Action("jd.upload", "Add a job description to the library", CORE, _library_upload("jd")),
)}

_BANNED = ("delete", "remove", "purge", "erase", "wipe", "drop", "destroy", "clear")
assert not [k for k in ACTIONS if any(w in k for w in _BANNED)], "no action may delete or remove anything"
