"""Matching tools: score every candidate against a job description with the application's own matching engine.

Matching is the same queued engine the Match page uses (so results, scoring and cost are identical). The tool waits a bounded
time for the result; if the run is still going it says so and hands back a job id for ``get_match_results``.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List

from app.agentic.tools.base import Tool, ToolContext, ToolError, ToolOutput, number, obj, text
from app.config.settings import settings
from app.security.rbac_rules import ALL_ROLES

ROLES = frozenset(ALL_ROLES)


def _shape(body: Dict[str, Any], limit: int, job_id: str) -> ToolOutput:
    candidates = sorted(body.get("candidates") or [], key=lambda c: -(c.get("overall_score") or 0))
    rows = [{
        "cv_id": c.get("cv_id"), "name": text(c.get("cv_name"), 80), "title": text(c.get("cv_job_title"), 80), "years": c.get("cv_years"),
        "score": round(float(c.get("overall_score") or 0) * 100), "skills": round(float(c.get("skills_score") or 0) * 100),
        "responsibilities": round(float(c.get("responsibilities_score") or 0) * 100), "title_fit": round(float(c.get("job_title_score") or 0) * 100),
        "missing_skills": [text(s, 60) for s in (c.get("unmatched_jd_skills") or [])[:4]],
    } for c in candidates[:limit]]
    job_title = text(body.get("jd_job_title"), 120)
    return ToolOutput({"status": "completed", "job_title": job_title, "candidates_scored": len(candidates), "top": rows},
                      {"type": "matches", "rows": rows, "total": len(candidates), "job_title": job_title, "job_id": job_id},
                      ("Top matches: " + "; ".join(f"{r['name']} {r['score']}% (cv_id={r['cv_id']})" for r in rows))[:700])


def _wait(ctx: ToolContext, body: Dict[str, Any], job_id: str) -> Dict[str, Any]:
    deadline = time.monotonic() + settings.AGENTIC_MATCH_WAIT_SECONDS
    while body.get("is_queued") or body.get("status") in ("queued", "processing"):
        if body.get("status") == "failed" or time.monotonic() >= deadline:
            break
        time.sleep(2)
        body = ctx.gateway.get(f"/api/match/jobs/{job_id}")
    if body.get("status") == "failed":
        raise ToolError("The matching run failed. Please try again.")
    return body


def match_cap() -> int:
    """The most CVs one matching run may score (the same ceiling the Match page and the API enforce)."""
    return int(settings.MATCH_MAX_CVS or 10_000)


def list_cv_categories(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    """The CV categories with how many CVs each holds. Shown as a card the person can tick, so the question "which categories and
    how many?" is answered in one click and one short message."""
    body = ctx.gateway.get("/api/cv/categories")
    cats = body.get("categories") or {}
    rows = sorted(({"name": text(k, 60), "count": int(v or 0)} for k, v in cats.items()), key=lambda r: -r["count"])[:40]
    total = sum(r["count"] for r in rows)
    cap = match_cap()
    return ToolOutput(
        {"categories": rows, "total_cvs": total, "max_cvs_per_match": cap,
         "next": f"Ask the person ONE short question: which categories, and how many CVs (the newest in those categories, at most {cap:,})."},
        {"type": "categories", "rows": rows, "total": total, "max_cvs": cap},
        "Categories shown: " + ", ".join(f"{r['name']} ({r['count']})" for r in rows[:12]))


def _chosen_categories(ctx: ToolContext, wanted: List[str]) -> tuple[List[str], int]:
    known = (ctx.gateway.get("/api/cv/categories").get("categories") or {})
    lookup = {str(k).lower(): str(k) for k in known}
    chosen: List[str] = []
    for w in wanted:
        real = lookup.get(w.strip().lower())
        if not real:
            raise ToolError(f"There is no category called \"{w}\". The categories are: " + ", ".join(sorted(lookup.values()))[:300])
        if real not in chosen:
            chosen.append(real)
    return chosen, sum(int(known[c] or 0) for c in chosen)


def run_matching(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    """Match CVs against one saved job description: only the categories the person picked, and only as many CVs as they asked for.

    The assistant never matches "everything": a run needs categories and a count, and the count is capped at MATCH_MAX_CVS (10,000)
    here and again by the matching API. Within the chosen categories the NEWEST CVs are taken, as on the Match page.
    """
    jd_id = text(args.get("jd_id"), 60)
    if not jd_id:
        raise ToolError("jd_id is required. List the job descriptions first and use the one the person means.")
    cap = match_cap()
    raw = args.get("categories")
    wanted = [text(c, 60) for c in ([raw] if isinstance(raw, str) else (raw or [])) if text(c, 60)]
    try:
        count = int(args.get("max_cvs"))
    except (TypeError, ValueError):
        count = 0
    if not wanted or count < 1:
        raise ToolError(f"Matching never runs on the whole database. First call list_cv_categories, then ask the person in ONE question which "
                        f"categories to use and how many CVs to match (at most {cap:,}).")
    if ctx.matches_run >= 1:
        return ToolOutput({"error": "One matching run per message. Ask the person if they want another."}, ok=False)
    chosen, available = _chosen_categories(ctx, wanted)
    take = min(count, available, cap)
    if take < 1:
        raise ToolError("Those categories have no CVs in them.")
    ctx.matches_run += 1
    scope = {"categories": chosen, "cvs_scored": take, "cvs_in_categories": available, "limited_to": cap}
    id_params = {"category": chosen[0]} if len(chosen) == 1 else {"categories": chosen}
    ids = (ctx.gateway.get("/api/cv/cvs", ids_only="true", limit=take, **id_params).get("ids") or [])[:take]
    if not ids:
        raise ToolError("No CVs could be found in those categories.")
    scope["cvs_scored"] = len(ids)
    limit = number(args.get("limit"), 10, 1, 15)
    body = ctx.gateway.post("/api/match", json={"jd_id": jd_id, "cv_ids": ids})
    job_id = str(body.get("job_id") or "")
    body = _wait(ctx, body, job_id) if job_id else body
    if body.get("candidates"):
        out = _shape(body, limit, job_id)
        out.data["scope"] = scope
        out.card["scope"] = scope
        return out
    progress = body.get("progress") or {}
    return ToolOutput({"status": "running", "job_id": job_id, "percent": progress.get("progress_percent"), "scope": scope,
                       "next": "Tell the person it is still running and offer to check again in a moment with get_match_results."},
                      {"type": "match_running", "job_id": job_id, "percent": progress.get("progress_percent"), "scope": scope},
                      f"Matching started on {len(ids):,} CVs (match_job_id={job_id})")


def get_match_results(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    job_id = text(args.get("match_job_id"), 64)
    if not job_id:
        raise ToolError("match_job_id is required.")
    limit = number(args.get("limit"), 10, 1, 15)
    body = ctx.gateway.get(f"/api/match/jobs/{job_id}")
    if body.get("status") == "failed":
        raise ToolError("The matching run failed.")
    if body.get("candidates"):
        return _shape(body, limit, job_id)
    progress = body.get("progress") or {}
    return ToolOutput({"status": body.get("status") or "running", "percent": progress.get("progress_percent")},
                      {"type": "match_running", "job_id": job_id, "percent": progress.get("progress_percent")}, f"Matching still running ({job_id})")


def match_status(gateway: Any, job_id: str, limit: int = 10) -> Dict[str, Any]:
    """Where a matching run is, for the card that polls (no model, no tokens): ``running`` with a percent, ``failed``, or ``completed``
    with the finished results card."""
    body = gateway.get(f"/api/match/jobs/{job_id}")
    if body.get("status") == "failed":
        return {"status": "failed"}
    if body.get("candidates"):
        out = _shape(body, limit, job_id)
        top = out.data["top"]
        return {"status": "completed", "card": out.card, "summary": f"Scored {out.data['candidates_scored']} CVs against {out.data['job_title'] or 'the job'}."
                + (f" The best match is {top[0]['name']} at {top[0]['score']}%." if top else "")}
    progress = body.get("progress") or {}
    return {"status": "running", "percent": progress.get("progress_percent")}


def match_setup_card(gateway: Any, hint: str = "") -> Dict[str, Any]:
    """ONE card for the whole "match CVs" question: pick the job description (searchable, paged), the CV categories (with counts) and
    how many CVs. Built without any model call; picking is done on screen and sent back as a structured selection."""
    from app.agentic.tools import pages

    jds = pages.descriptions_page(gateway, query=hint)
    cats = gateway.get("/api/cv/categories").get("categories") or {}
    rows = sorted(({"name": text(k, 60), "count": int(v or 0)} for k, v in cats.items()), key=lambda r: -r["count"])[:40]
    return {"type": "match_setup",
            "jds": {"rows": jds.rows, "total": jds.total, "page": pages.descriptor("list_job_descriptions", {"query": hint}, jds)},
            "categories": {"rows": rows, "total": sum(r["count"] for r in rows), "max_cvs": match_cap()},
            "preselect": jds.rows[0]["jd_id"] if (hint and len(jds.rows) == 1) else None}


def run_selection(ctx: ToolContext, selection: Dict[str, Any]) -> ToolOutput:
    """The person's picks from the setup card. Validated here and run through the same run_matching (same limits, same engine)."""
    categories = selection.get("categories")
    if not isinstance(categories, list):
        raise ToolError("Pick at least one category.")
    try:
        count = int(selection.get("max_cvs"))
    except (TypeError, ValueError):
        raise ToolError("Say how many CVs to match.")
    return run_matching(ctx, {"jd_id": selection.get("jd_id"), "categories": categories, "max_cvs": count, "limit": 10})


TOOLS = [
    Tool("list_cv_categories", "List the CV categories with how many CVs each has. Call this BEFORE run_matching, then ask the person ONE question: "
         "which categories and how many CVs to match.", obj(), ROLES, list_cv_categories),
    Tool("run_matching", "Match CVs against one saved job description. Needs the categories the person chose and how many CVs they want "
         "(the newest in those categories; never more than 10,000). Refuses to run without both. Heavy: only when asked to match or rank.",
         obj(jd_id={"type": "string", "description": "The job description's id from list_job_descriptions."},
             categories={"type": "array", "items": {"type": "string"}, "description": "Category names the person chose (from list_cv_categories)."},
             max_cvs={"type": "integer", "description": "How many CVs to match, at most 10,000."}, limit={"type": "integer", "description": "How many top results to show."},
             required=["jd_id", "categories", "max_cvs"]), ROLES, run_matching, writes=True),
    Tool("get_match_results", "Check a matching run that was still going, using the match job id it returned.",
         obj(match_job_id={"type": "string"}, limit={"type": "integer"}, required=["match_job_id"]), ROLES, get_match_results),
]
