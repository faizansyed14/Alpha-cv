"""Tools that PROPOSE a change. None of them changes anything: each one validates what the person asked for, reads what it needs
to show the before and after, and puts a card with Confirm and Cancel on screen (``actions/flow.py``). The change itself is made
only after the person confirms, by code in ``actions/catalog.py``.
"""
from __future__ import annotations

from typing import Any, Dict

from app.agentic.actions import catalog, flow
from app.agentic.guardrails.output_guard import safe_text
from app.agentic.tools.base import Tool, ToolContext, ToolError, ToolOutput, obj, text

CORE = frozenset({"admin", "user", "manager", "evp"})
TRACKER = catalog.TRACKER_ALL
ADMIN = frozenset({"admin"})
_AREAS = {"type": "string", "enum": list(catalog.TRACKER_FIELDS), "description": "follow-ups, job-openings, candidates or applications."}


def propose_candidate_note(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    cv_id, note = text(args.get("cv_id"), 60), str(args.get("note") or "").strip()
    if not cv_id:
        raise ToolError("cv_id is required. Search for the candidate first.")
    if len(note) < 2:
        raise ToolError("Ask the person what the note should say.")
    cv = (ctx.gateway.get(f"/api/cv/{cv_id}").get("cv") or {}).get("candidate") or {}
    name = safe_text(cv.get("full_name"), 80) or "the candidate"
    # The application keeps ONE note per person per candidate and saving replaces it. So by default the new text is added after the
    # person's existing note, and nothing they wrote is lost; "replace" is only used when they ask for it.
    mine = next((n for n in (ctx.gateway.get(f"/api/cv/{cv_id}/note").get("notes") or []) if n.get("hr_user") == ctx.username), None)
    before = str((mine or {}).get("note") or "").strip()
    replace = str(args.get("mode") or "").lower() == "replace"
    final = note if (replace or not before) else f"{before}\n\n{note}"
    if len(final) > 5000:
        raise ToolError("The note would be longer than 5,000 characters. Make it shorter.")
    rows = [("Candidate", name)]
    if before:
        rows.append(("Your note now", before[:300]))
    rows.append(("Your note after", final[-600:] if len(final) > 600 else final))
    return flow.propose(ctx, "note.add", rows, {"cv_id": cv_id, "name": name, "note": final},
                        warning="This replaces your current note with the text above." if (before and replace) else "")


def propose_job_status(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    job_id = text(args.get("job_id"), 60)
    if not job_id:
        raise ToolError("job_id is required. List the jobs first.")
    if not isinstance(args.get("open"), bool):
        raise ToolError("Say whether the job should be open or closed.")
    opening = args["open"]
    current = ctx.gateway.get(f"/api/careers/admin/jobs/{job_id}/edit-data")          # also applies the access rule: only your own jobs (admins: any)
    title = safe_text(current.get("job_title"), 90) or "the job"
    reason = text(args.get("reason"), 300)
    rows = [("Job", title), ("New status", "Open (shown on the careers page)" if opening else "Closed (no new applications)")]
    if reason:
        rows.append(("Reason", reason))
    return flow.propose(ctx, "job.status", rows, {"job_id": job_id, "title": title, "is_active": opening, "reason": reason},
                        title="Open this job" if opening else "Close this job")


_JOB_LABEL = {"job_title": "Title", "job_location": "Location", "job_summary": "Summary", "key_responsibilities": "Responsibilities",
              "qualifications": "Qualifications", "company_name": "Company"}


def propose_job_changes(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    job_id = text(args.get("job_id"), 60)
    if not job_id:
        raise ToolError("job_id is required. List the jobs first.")
    changes = {k: str(args[k]).strip()[:6000] for k in catalog.JOB_FIELDS if str(args.get(k) or "").strip()}
    if not changes:
        raise ToolError("Say what to change: the title, location, summary, responsibilities, qualifications or company.")
    current = ctx.gateway.get(f"/api/careers/admin/jobs/{job_id}/edit-data")
    rows = [("Job", safe_text(current.get("job_title"), 90) or "the job")]
    for key, value in changes.items():
        rows.append((_JOB_LABEL[key], f"{text(current.get(key), 120) or '(empty)'}  ->  {text(value, 200)}"))
    return flow.propose(ctx, "job.edit", rows, {"job_id": job_id, "changes": changes})


def propose_tracker_add(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    area = text(args.get("area"), 30)
    if area in catalog.TRACKER_WRITERS and ctx.role not in catalog.TRACKER_WRITERS[area]:
        raise ToolError("Your role cannot add to that part of the tracker.")
    fields = catalog.clean_fields(area, args.get("details"))
    rows = [(k.replace("_", " ").capitalize(), v) for k, v in fields.items()]
    return flow.propose(ctx, "tracker.create", rows, {"resource": area, "fields": fields}, title=f"Add a {catalog.TRACKER_LABEL[area]}")


def propose_tracker_change(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    area = text(args.get("area"), 30)
    if area in catalog.TRACKER_WRITERS and ctx.role not in catalog.TRACKER_WRITERS[area]:
        raise ToolError("Your role cannot change that part of the tracker.")
    ref = text(args.get("ref"), 64)
    if not ref:
        raise ToolError("ref is required: read the tracker first and use the row's ref.")
    fields = catalog.clean_fields(area, args.get("details"))
    rows = [("Row", text(args.get("label"), 120) or catalog.TRACKER_LABEL[area])] + [(k.replace("_", " ").capitalize(), v) for k, v in fields.items()]
    return flow.propose(ctx, "tracker.update", rows, {"resource": area, "ref": ref, "fields": fields}, title=f"Update the {catalog.TRACKER_LABEL[area]}")


def propose_follow_up_reminder(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    ref = text(args.get("ref"), 64)
    if not ref:
        raise ToolError("ref is required: read the follow-ups first and use the row's ref.")
    return flow.propose(ctx, "tracker.reminder", [("Follow-up", text(args.get("label"), 160) or "the follow-up")], {"ref": ref},
                        warning="This sends an email to the people on that follow-up.")


def propose_notice(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    message = str(args.get("message") or "").strip()
    if len(message) < 3:
        raise ToolError("Ask the person what the notice should say.")
    return flow.propose(ctx, "notice.set", [("Notice", message[:600])], {"message": message[:4000]},
                        warning="Every signed-in user will see this notice until it is changed.")


def propose_token_answer(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    ref, decision = text(args.get("ref"), 64), text(args.get("decision"), 10).lower()
    if decision not in ("approve", "reject"):
        raise ToolError("decision must be approve or reject.")
    waiting = ctx.gateway.get("/api/agents/admin/reset-requests").get("pending") or []
    found = next((r for r in waiting if str(r.get("id")) == ref), None)
    if found is None:
        raise ToolError("That request is not waiting any more. Read the waiting requests again.")
    who = text(found.get("username"), 40)
    return flow.propose(ctx, "tokens.decide", [("Person", who), ("Used today", f"{found.get('used')} of {found.get('limit')} tokens"),
                                              ("Reason", text(found.get("reason"), 200) or "none given"),
                                              ("Decision", "Approve: their count goes back to zero" if decision == "approve" else "Reject: nothing changes for them")],
                        {"request_id": ref, "username": who, "decision": decision}, title="Approve this request" if decision == "approve" else "Reject this request")


def _upload(kind: str, label: str):
    def run(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
        att = ctx.attachment
        if not att or not att.get("ref"):
            raise ToolError("No file is attached. Ask the person to attach it with the paperclip.")
        return flow.propose(ctx, f"{kind}.upload", [("File", safe_text(att.get("filename"), 120)), ("Goes to", label)],
                            {"ref": att["ref"], "filename": att.get("filename")})
    return run


propose_cv_upload = _upload("cv", "the CV library (read and indexed like the Upload page)")
propose_jd_upload = _upload("jd", "the job descriptions library")

TOOLS = [
    Tool("propose_candidate_note", "Put a note on a candidate's profile (shown for confirmation first). Use the cv_id from search_candidates.",
         obj(cv_id={"type": "string"}, note={"type": "string", "description": "The note text, in the person's words."},
             mode={"type": "string", "enum": ["append", "replace"], "description": "append (default) adds to the person's existing note; replace overwrites it."}, required=["cv_id", "note"]), CORE, propose_candidate_note, writes=True),
    Tool("propose_job_status", "Open or close one job posting (shown for confirmation first). Use the job_id from list_jobs.",
         obj(job_id={"type": "string"}, open={"type": "boolean", "description": "true to open the job, false to close it."}, reason={"type": "string"},
             required=["job_id", "open"]), CORE, propose_job_status, writes=True),
    Tool("propose_job_changes", "Change details of a job posting that exists (shown as before and after, for confirmation first). Pass only what changes.",
         obj(job_id={"type": "string"}, job_title={"type": "string"}, job_location={"type": "string"}, job_summary={"type": "string"},
             key_responsibilities={"type": "string"}, qualifications={"type": "string"}, company_name={"type": "string"}, required=["job_id"]), CORE, propose_job_changes, writes=True),
    Tool("propose_tracker_add", "Add a row to the tracker: a follow-up, job opening, tracker candidate or application (shown for confirmation first). "
         "details holds the fields, for example for a follow-up: client_name, position, current_stage, next_follow_up_date (YYYY-MM-DD), remarks.",
         obj(area=_AREAS, details={"type": "object", "description": "Field names and values."}, required=["area", "details"]), TRACKER, propose_tracker_add, writes=True),
    Tool("propose_tracker_change", "Change a tracker row (shown for confirmation first). ref comes from the tracker read tools; details holds only the fields that change.",
         obj(area=_AREAS, ref={"type": "string"}, label={"type": "string", "description": "A short name for the row, shown to the person."},
             details={"type": "object"}, required=["area", "ref", "details"]), TRACKER, propose_tracker_change, writes=True),
    Tool("propose_follow_up_reminder", "Send the reminder email for one follow-up (shown for confirmation first). ref comes from tracker_follow_ups.",
         obj(ref={"type": "string"}, label={"type": "string"}, required=["ref"]), TRACKER, propose_follow_up_reminder, writes=True),
    Tool("propose_notice", "Admin: show a notice to every user (shown for confirmation first).", obj(message={"type": "string"}, required=["message"]), ADMIN, propose_notice, writes=True),
    Tool("propose_token_answer", "Admin: approve or reject a waiting token reset request (shown for confirmation first). ref comes from pending_token_requests.",
         obj(ref={"type": "string"}, decision={"type": "string", "enum": ["approve", "reject"]}, required=["ref", "decision"]), ADMIN, propose_token_answer, writes=True),
    Tool("propose_cv_upload", "Add the attached CV file to the CV library (shown for confirmation first). Use when the person attached a CV and wants it saved.",
         obj(), CORE, propose_cv_upload, writes=True),
    Tool("propose_jd_upload", "Add the attached job description file to the job descriptions library WITHOUT posting a job (shown for confirmation first).",
         obj(), CORE, propose_jd_upload, writes=True),
]
