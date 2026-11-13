"""The kinds of change Agentic mode can make once the person has confirmed them. Each kind is data plus one small function that
calls the application's own endpoint through ``ApiGateway.act``. There is deliberately no kind that deletes, removes or resets."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, FrozenSet

from app.agentic import uploads
from app.agentic.tools.base import ToolError, text
from app.agentic.tools.gateway import ApiGateway
from app.security.rbac_rules import ALL_ROLES, SELECTION_ROLES, TRACKER_FULL_ROLES

CORE = frozenset(ALL_ROLES)          # every role has the same access; only ADMIN actions are limited
ADMIN = frozenset({"admin"})
TRACKER_FULL = frozenset(TRACKER_FULL_ROLES)           # who may add a requirement
SELECTIONS = frozenset(SELECTION_ROLES)                # who may use selections and joining (not recruiters)

_ID = re.compile(r"^[\w-]{8,64}$")
_CV_ID = re.compile(r"^[0-9a-fA-F-]{32,40}$")

JOB_FIELDS = ("job_title", "job_location", "job_summary", "key_responsibilities", "qualifications")


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


# what a requirement or selection change may carry: nothing else is ever sent (the application checks the person's role on each field again)
REQUIREMENT_KEYS = frozenset({"position", "client", "requirement_date", "cv_submission_date", "job_location", "salary", "duration_type", "duration_value", "duration_unit",
                              "duration_extendable", "recruiter_ids", "manager_id", "sales_manager_id", "status", "sales_comments", "rm_comments", "recruiter_comments",
                              "cvs_submissions"})
SELECTION_KEYS = frozenset({"selection_date", "candidate_name", "status", "comments"})


def _clean(body: Any, allowed: FrozenSet[str]) -> Dict[str, Any]:
    if not isinstance(body, dict) or not body:
        raise ToolError("There is nothing to change.")
    extra = set(body) - allowed
    if extra:
        raise ToolError("That change is not allowed.")
    return dict(body)


def _requirement_create(gw: ApiGateway, p: Dict[str, Any], _user: str) -> str:
    body = _clean(p.get("body"), REQUIREMENT_KEYS)
    gw.act("POST", "/api/tracker/requirements", json=body)
    return f"Added the requirement {text(p.get('title'), 120)}."


def _requirement_update(gw: ApiGateway, p: Dict[str, Any], _user: str) -> str:
    rid = str(p.get("requirement_id") or "")
    if not _ID.match(rid):
        raise ToolError("That requirement could not be identified.")
    body = _clean(p.get("body"), REQUIREMENT_KEYS)
    gw.act("PATCH", f"/api/tracker/requirements/{rid}", json=body)
    title = text(p.get("title"), 120) or "The requirement"
    if body.get("status") == "closed":
        return f"{title} is closed. It is on the Closures page and has a row on Selections and joining."
    if body.get("status") == "open":
        return f"{title} is open again."
    return f"Updated {title}."


def _selection_update(gw: ApiGateway, p: Dict[str, Any], _user: str) -> str:
    sid = str(p.get("selection_id") or "")
    if not _ID.match(sid):
        raise ToolError("That selection could not be identified.")
    gw.act("PATCH", f"/api/tracker/selections/{sid}", json=_clean(p.get("body"), SELECTION_KEYS))
    return f"Updated the selection for {text(p.get('title'), 120)}."


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
    Action("notice.set", "Change the notice shown to everyone", ADMIN, _notice, outward=True),
    Action("tokens.decide", "Answer a token reset request", ADMIN, _token_decision),
    Action("requirement.create", "Add a requirement", TRACKER_FULL, _requirement_create),
    Action("requirement.update", "Update a requirement", CORE, _requirement_update),
    Action("selection.update", "Update a selection", SELECTIONS, _selection_update),
    Action("cv.upload", "Add a CV to the library", CORE, _library_upload("cv")),
    Action("jd.upload", "Add a job description to the library", CORE, _library_upload("jd")),
)}

_BANNED = ("delete", "remove", "purge", "erase", "wipe", "drop", "destroy", "clear")
assert not [k for k in ACTIONS if any(w in k for w in _BANNED)], "no action may delete or remove anything"
