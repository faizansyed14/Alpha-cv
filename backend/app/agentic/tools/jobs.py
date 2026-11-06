"""Job tools: list the job postings and job descriptions, draft a posting, and (after the person confirms) publish it.

Posting is two steps by design. ``draft_job_post`` only prepares a draft that is shown on screen. ``publish_job_post`` takes no
arguments at all: it publishes exactly the draft the person was shown, and only when this turn's message is a plain yes
(guardrails/confirmation.py). The model cannot publish something the person has not seen.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from app.agentic import uploads
from app.agentic.tools import pages
from app.agentic.tools.base import Tool, ToolContext, ToolError, ToolOutput, number, obj, text

ROLES = frozenset({"admin", "user", "manager", "evp"})

_DRAFT_FIELDS = ("job_title", "job_location", "job_summary", "key_responsibilities", "qualifications", "company_name", "additional_info")
_LIMITS = {"job_title": 200, "job_location": 120, "job_summary": 2500, "key_responsibilities": 3500, "qualifications": 3500,
           "company_name": 120, "additional_info": 1500}


def _choices(rows: list, key: str = "title") -> Optional[list]:
    names = [r[key] for r in rows if r.get(key)]
    return names[:6] if 2 <= len(names) <= 6 else None


def list_jobs(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    """Look up job postings. They are drawn on screen only when the person asked to see them; otherwise this is a lookup for another task."""
    keep = {"query": text(args.get("query"), 80), "include_inactive": bool(args.get("include_inactive"))}
    page = pages.jobs_page(ctx.gateway, limit=number(args.get("limit"), pages.PAGE, 1, 25), **keep)
    ctx.see(*(r["job_id"] for r in page.rows))
    card = {"type": "jobs", "rows": page.rows, "total": page.total, "page": pages.descriptor("list_jobs", keep, page)} if ctx.show_lists else None
    names = "; ".join(f"{r['title']} (job_id={r['job_id']})" for r in page.rows[:pages.MODEL_ROWS])
    out = ToolOutput(pages.for_model(page.rows, ["job_id", "title", "location", "applications"], page.total, bool(card)), card, f"Jobs found: {page.total}; top: {names}"[:700])
    out.choices = None if card else _choices(page.rows)
    return out


def list_job_descriptions(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    """Look up saved job descriptions (a library that can hold thousands). Search with ``query``; never list everything to find one."""
    keep = {"query": text(args.get("query"), 80)}
    page = pages.descriptions_page(ctx.gateway, limit=number(args.get("limit"), pages.PAGE, 1, 25), **keep)
    ctx.see(*(r["jd_id"] for r in page.rows))
    card = {"type": "job_descriptions", "rows": page.rows, "total": page.total, "page": pages.descriptor("list_job_descriptions", keep, page)} if ctx.show_lists else None
    names = "; ".join(f"{r['title']} (jd_id={r['jd_id']})" for r in page.rows[:pages.MODEL_ROWS])
    out = ToolOutput(pages.for_model(page.rows, ["jd_id", "title"], page.total, bool(card)), card, f"Job descriptions found: {page.total}; top: {names}"[:700])
    out.choices = None if card else _choices(page.rows)
    return out


_LONG = ("job_summary", "key_responsibilities", "qualifications", "additional_info")
_NO_LOCATION = {"", "location not specified", "not specified", "n/a", "none", "unknown"}


def _blank_location(value: Any) -> bool:
    return str(value or "").strip().lower() in _NO_LOCATION


def _missing(fields: Dict[str, Any]) -> list:
    out = []
    if not str(fields.get("job_title") or "").strip():
        out.append("job_title")
    if _blank_location(fields.get("job_location")):
        out.append("job_location")
    return out


def _source(ctx: ToolContext, earlier: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Where the draft came from (a file the person attached): its staged reference, name and the JD library id once it was read."""
    base, att = earlier.get("_attachment") or {}, ctx.attachment or {}
    merged = {k: base.get(k) or att.get(k) for k in ("ref", "filename", "jd_id")}
    return {k: v for k, v in merged.items() if v} or None


def read_job_file(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    """Read the attached job description exactly as the Careers page does it, in the same three steps:

        1. POST /api/jd/upload-jd                         the file is read and saved in the job description library
        2. POST /api/careers/admin/jobs/{jd_id}/extract-ui-data   the AI reads it into the form fields (title, location, summary ...)
        3. (after the person confirms)  POST /api/careers/admin/jobs/unified-update   the posting is created from those fields

    The result is a draft on screen with the fields exactly as extracted, so nothing is re-typed by the model.
    """
    att = ctx.attachment
    if not att:
        raise ToolError("No job description file is attached. Ask the person to upload it.")
    if att.get("jd_id"):
        return ToolOutput({"status": "already_read", "next": "The file was already read; the draft is on screen. Use draft_job_post for changes."}, ok=False)
    staged = uploads.read_bytes(ctx.username, att["ref"])
    if staged is None:
        raise ToolError("The uploaded file is no longer available. Ask the person to upload it again.")
    data, filename, mime = staged
    upload = ctx.gateway.post("/api/jd/upload-jd", files={"file": (filename, data, mime)})
    jd_id = str(upload.get("jd_id") or "")
    if not jd_id:
        raise ToolError("The application could not read that file. Ask for another file or for the details as text.")
    ui = ctx.gateway.post(f"/api/careers/admin/jobs/{jd_id}/extract-ui-data", data={})
    att["jd_id"] = jd_id
    fields = {
        "job_title": text(ui.get("job_title"), _LIMITS["job_title"]),
        "job_location": "" if _blank_location(ui.get("job_location")) else text(ui.get("job_location"), _LIMITS["job_location"]),
        "company_name": "", "additional_info": "",
        "job_summary": str(ui.get("job_summary") or "").strip()[:_LIMITS["job_summary"]],
        "key_responsibilities": str(ui.get("key_responsibilities") or "").strip()[:_LIMITS["key_responsibilities"]],
        "qualifications": str(ui.get("qualifications") or "").strip()[:_LIMITS["qualifications"]],
    }
    missing = _missing(fields)
    card = {"type": "job_draft", "fields": fields, "attachment": {"ref": att["ref"], "filename": att["filename"], "jd_id": jd_id}, "missing": missing}
    result = {"status": "needs_" + missing[0] if missing else "draft_ready", "job_title": fields["job_title"], "location": fields["job_location"] or None,
              "missing": missing,
              "next": ("The draft is on screen, but " + ("the location" if "job_location" in missing else "the title") +
                       " is missing. Ask the person for it, then call draft_job_post with just that.") if missing else
              "The draft is on screen. Ask the person to confirm it or to say what to change."}
    return ToolOutput(result, card, f"Job file read, draft on screen: {fields['job_title']}" + (f" (missing {', '.join(missing)})" if missing else ""))


def draft_job_post(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    """A new draft, or a CHANGE to the draft already on screen: fields the person did not mention keep their earlier value, so
    "keep Dubai" updates the location and leaves everything else as it was. Nothing is posted here."""
    earlier = ctx.pending_draft or {}
    draft = {}
    for k in _DRAFT_FIELDS:
        given = str(args.get(k) or "").strip() if k in _LONG else text(args.get(k), _LIMITS[k])
        draft[k] = (given or str(earlier.get(k) or ""))[:_LIMITS[k]]
    if not draft["job_title"]:
        raise ToolError("A job title is required. Ask the person for it.")
    if _blank_location(draft["job_location"]):
        raise ToolError("The location is missing. Ask the person where the job is based (or whether it is remote) before drafting.")
    if not (draft["job_summary"] or draft["key_responsibilities"] or draft["qualifications"]):
        raise ToolError("Add at least a summary, the responsibilities or the qualifications. Ask the person for them.")
    source = _source(ctx, earlier)
    card = {"type": "job_draft", "fields": draft, "missing": []}
    if source:
        card["attachment"] = source
    return ToolOutput({"status": "draft_ready", "from_file": bool(source),
                       "next": "The draft is on screen. Ask the person to confirm it or to say what to change."},
                      card, f"Draft job post ready for confirmation: {draft['job_title']}")


def _subject_of(ctx: ToolContext, job_id: str) -> str:
    """The unique subject line the application generated for the new job (the create call does not return it)."""
    try:
        body = ctx.gateway.get("/api/careers/admin/jobs", limit=25)
        jobs = body.get("jobs") if isinstance(body, dict) else body
        return next((text(j.get("email_subject_template"), 160) for j in (jobs or []) if j.get("job_id") == job_id), "")
    except ToolError:
        return ""


def publish_job_post(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    if ctx.published:
        return ToolOutput({"error": "That job was already posted in this conversation turn."}, ok=False)
    if not ctx.pending_draft:
        return ToolOutput({"error": "There is no draft waiting. Draft the job first and let the person see it."}, ok=False)
    if not ctx.confirmed:
        return ToolOutput({"error": "The person has not confirmed. Show the draft and ask them to confirm; only a plain yes counts."}, ok=False)
    source = ctx.pending_draft.get("_attachment")
    form = {k: v for k, v in ctx.pending_draft.items() if v and not k.startswith("_")}
    missing = _missing(form)
    if missing:
        return ToolOutput({"error": "The " + ("location" if "job_location" in missing else "title") + " is still missing. Tell me what it is and I will update the draft."}, ok=False)
    if source:
        if not source.get("jd_id"):
            return ToolOutput({"error": "The file has not been read yet. Read it first."}, ok=False)
        # step 3 of the Careers page form: create the posting from the (reviewed) fields. Create only: no job_id is ever sent.
        body = ctx.gateway.post("/api/careers/admin/jobs/unified-update", data={
            "jd_id": source["jd_id"], "job_title": form["job_title"], "job_location": form["job_location"], "job_summary": form.get("job_summary", ""),
            "key_responsibilities": form.get("key_responsibilities", ""), "qualifications": form.get("qualifications", ""),
            **{k: form[k] for k in ("company_name", "additional_info") if form.get(k)}})
        job_id, token = body.get("job_id"), body.get("public_token")
        card = {"type": "job_posted", "job_id": job_id, "title": form["job_title"], "public_link": f"/careers/jobs/{token}" if token else None,
                "public_token": token, "subject": _subject_of(ctx, str(job_id))}
        uploads.release(ctx.username, source.get("ref", ""))
    else:
        body = ctx.gateway.post("/api/careers/admin/jobs/post", data=form)
        card = {"type": "job_posted", "job_id": body.get("job_id"), "title": text(body.get("job_title"), 120), "public_link": body.get("public_link"),
                "public_token": body.get("public_token"), "subject": text(body.get("email_subject_template"), 160)}
    ctx.published = True
    ctx.pending_draft = None
    ctx.see(card["job_id"])
    return ToolOutput({"status": "posted", "job_title": card["title"], "subject": card["subject"]}, card,
                      f"Job posted: {card['title']} (job_id={card['job_id']})")


TOOLS = [
    Tool("list_jobs", "List the job postings (open roles) this person can see, with how many applications each has.",
         obj(query={"type": "string", "description": "Optional words from the title or location."}, limit={"type": "integer"},
             include_inactive={"type": "boolean"}), ROLES, list_jobs),
    Tool("list_job_descriptions", "List the saved job descriptions (the library used for matching and for interview questions).",
         obj(query={"type": "string"}, limit={"type": "integer"}), ROLES, list_job_descriptions),
    Tool("read_job_file", "Read the job description file the person attached, the same way the Careers page does (it is saved to the job description "
         "library and its title, location, summary, responsibilities and qualifications are extracted). The draft appears on screen exactly as extracted. "
         "Takes no arguments; call it first whenever a file is attached.",
         obj(), ROLES, read_job_file, writes=True),
    Tool("draft_job_post", "Prepare a draft job posting from what the person told you. It is only SHOWN; nothing is posted. "
         "Use their own words; never invent salary, benefits or company facts.",
         obj(job_title={"type": "string"}, job_location={"type": "string"}, job_summary={"type": "string"},
             key_responsibilities={"type": "string", "description": "Bullet lines."}, qualifications={"type": "string", "description": "Bullet lines."},
             company_name={"type": "string"}, additional_info={"type": "string"}, required=["job_title"]), ROLES, draft_job_post, writes=True),
    Tool("publish_job_post", "Publish the draft that is on screen. Takes no arguments. Works only right after the person confirmed the draft.",
         obj(), ROLES, publish_job_post, writes=True),
]
