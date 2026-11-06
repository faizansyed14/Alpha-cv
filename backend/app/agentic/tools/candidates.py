"""Candidate tools (read only): search the CV database, read one profile, see who applied to a job.

Contact details (e-mail, phone) are left out on purpose: the model does not need them to review a candidate, and the saved chat
history should not become a second copy of people's contact data.

Lists go through ``pages.py``: the person sees a page of results (with "Show more"), the model sees only a few rows and the total.
A search done only to FIND someone for another task ("interview questions for Aisha") is not drawn on screen.
"""
from __future__ import annotations

import re
from typing import Any, Dict

from app.agentic.guardrails.output_guard import safe_text
from app.agentic.tools import pages
from app.agentic.tools.base import Tool, ToolContext, ToolError, ToolOutput, number, obj, text

ROLES = frozenset({"admin", "user", "manager", "evp"})
_MODEL_KEYS = ["id", "name", "title", "years", "location"]


def _result(ctx: ToolContext, tool: str, args: Dict[str, Any], page: pages.Page, card_extra: Dict[str, Any], label: str, always_show: bool = False) -> ToolOutput:
    ctx.see(*(r["id"] for r in page.rows))
    show = always_show or ctx.show_lists
    card = {"type": "candidates", "rows": page.rows, "total": page.total, "page": pages.descriptor(tool, args, page), **card_extra} if show else None
    names = "; ".join(f"{r['name']} (cv_id={r['id']})" for r in page.rows[:pages.MODEL_ROWS])
    return ToolOutput(pages.for_model(page.rows, _MODEL_KEYS, page.total, show), card, f"{label}: {page.total} match; top: {names}"[:700])


def search_candidates(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    limit = number(args.get("limit"), pages.PAGE, 1, 25)
    clean = {"query": text(args.get("query"), 80), "category": text(args.get("category"), 60)}
    page = pages.candidates_page(ctx.gateway, limit=limit, **clean)
    return _result(ctx, "search_candidates", clean, page, {}, "Candidate search")


def _squash(value: str) -> str:
    """Curly quotes made straight and whitespace collapsed (case is kept: AND / OR / NOT matter)."""
    return " ".join(str(value or "").replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'").split())


_SYNTAX = re.compile(r'[()"]|\b(?:AND|OR|NOT)\b')


def _is_the_pasted_string(query: str, message: str) -> bool:
    """True when ``query`` is the Boolean string from the person's message: it appears in it, and everything the model left out of
    the message is plain words (like "search this"). Dropping a clause, a bracket or a quote is refused."""
    q, m = _squash(query), _squash(message)
    at = m.lower().find(q.lower())
    if not q or at < 0:
        return False
    return not _SYNTAX.search(m[:at] + " " + m[at + len(q):])


def boolean_search(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    """Search the CV database with a Boolean string the person pasted, e.g. ("Cloud Engineer") AND (Azure OR AWS) NOT intern.

    The string is used EXACTLY as pasted: the tool refuses a string that is not in the person's own message, so the model can never
    rewrite or "improve" it. The application's own advanced search does the work (so the results match the Candidates page).
    """
    query = str(args.get("boolean_query") or "").strip()
    if not query:
        raise ToolError("boolean_query is required: the Boolean string the person pasted.")
    if not _is_the_pasted_string(query, ctx.message):
        raise ToolError("Use the Boolean string exactly as the person pasted it, character for character.")
    locations = [text(x, 60) for x in (args.get("locations") or []) if text(x, 60)][:10]
    page = pages.boolean_page(ctx.gateway, query=query, limit=number(args.get("limit"), pages.PAGE, 1, 25), experience_min=args.get("experience_min"), locations=locations)
    keep = {"boolean_query": query[:4000], "experience_min": args.get("experience_min"), "locations": locations, "total": page.total}
    return _result(ctx, "boolean_search", keep, page, {"title": "Boolean search results", "query": query[:400]}, "Boolean search", always_show=True)


def get_candidate(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    cv_id = text(args.get("cv_id"), 60)
    if not cv_id:
        raise ToolError("cv_id is required. Search for the candidate first.")
    body = ctx.gateway.get(f"/api/cv/{cv_id}")
    cv = body.get("cv") or {}
    cand = cv.get("candidate") or {}
    app = cv.get("job_application") or {}
    profile = {
        "name": safe_text(cand.get("full_name"), 80), "title": safe_text(cand.get("job_title"), 80), "years": cand.get("years_of_experience"),
        "location": safe_text(cand.get("location"), 60), "nationality": safe_text(cand.get("nationality"), 40),
        "notice_period": safe_text((cv.get("structured_info") or {}).get("notice_period"), 40), "expected_salary": cand.get("expected_salary"),
        "languages": [safe_text(x, 30) for x in (cand.get("languages") or [])[:8]],
        "skills": [safe_text(x, 120) for x in (cand.get("skills") or [])[:20]],
        "responsibilities": [safe_text(x, 160) for x in (cand.get("responsibilities") or [])[:8]],
        "applied_for_job": bool(app), "application_status": safe_text(app.get("application_status"), 30) or None,
    }
    ctx.see(cv_id)
    try:        # what the team already wrote about this person (the classic profile shows it too)
        notes = [{"by": text(x.get("hr_user"), 40), "note": safe_text(x.get("note"), 300), "updated": text(x.get("updated_at"), 10)}
                 for x in (ctx.gateway.get(f"/api/cv/{cv_id}/note").get("notes") or [])[:3]]
    except ToolError:
        notes = []
    return ToolOutput({"profile": profile, "team_notes": len(notes)}, {"type": "candidate_profile", "cv_id": cv_id, **profile, "notes": notes},
                      f"Profile read: {profile['name']} (cv_id={cv_id})")


def get_job_applications(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    job_id = text(args.get("job_id"), 60)
    if not job_id:
        raise ToolError("job_id is required. List the jobs first.")
    limit = number(args.get("limit"), pages.PAGE, 1, 20)
    rows = ctx.gateway.get(f"/api/careers/admin/jobs/{job_id}/applications")
    rows = rows if isinstance(rows, list) else []
    rows.sort(key=lambda r: (r.get("match_score") is None, -(r.get("match_score") or 0)))
    shown = [{
        "application_id": r.get("application_id"), "name": text(r.get("applicant_name"), 80), "years": r.get("years_of_experience"),
        "location": text(r.get("location"), 60), "notice_period": text(r.get("notice_period"), 40), "nationality": text(r.get("nationality"), 40),
        "expected_salary": r.get("expected_salary"), "status": text(r.get("status"), 30), "match_score": r.get("match_score"),
        "applied": text(r.get("application_date"), 10),
    } for r in rows[:limit]]
    ctx.see(job_id)
    return ToolOutput(pages.for_model(shown, ["name", "years", "location", "status", "match_score"], len(rows), True),
                      {"type": "applications", "rows": shown, "total": len(rows), "job_id": job_id},
                      f"Applications read for job_id={job_id}: {len(rows)} in total")


TOOLS = [
    Tool("search_candidates", "Search the candidate (CV) database by name, job title or keyword, optionally inside one category. Returns the total and the top few "
         "matches with their ids. Use a narrow query: never page through results to find someone.",
         obj(query={"type": "string", "description": "Name, job title or keyword."},
             category={"type": "string", "description": "Optional CV category."},
             limit={"type": "integer", "description": "How many to fetch (the person sees up to 25)."}),
         ROLES, search_candidates),
    Tool("boolean_search", "Search the CV database with a Boolean string the person pasted in the chat (AND, OR, NOT, quotes, brackets). Pass the string "
         "EXACTLY as pasted. Use this whenever the message contains such a string.",
         obj(boolean_query={"type": "string", "description": "The pasted Boolean string, unchanged."}, experience_min={"type": "number"},
             locations={"type": "array", "items": {"type": "string"}}, limit={"type": "integer"}, required=["boolean_query"]), ROLES, boolean_search),
    Tool("get_candidate", "Read one candidate's profile (skills, experience, location, notice period) so you can review them.",
         obj(cv_id={"type": "string", "description": "The candidate's id from search_candidates."}, required=["cv_id"]), ROLES, get_candidate),
    Tool("get_job_applications", "List the people who applied to one job posting, best match first.",
         obj(job_id={"type": "string", "description": "The job's id from list_jobs."}, limit={"type": "integer"}, required=["job_id"]),
         ROLES, get_job_applications),
]
