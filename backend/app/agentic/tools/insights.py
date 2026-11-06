"""Read-only look-ups for the rest of the application: candidate notes, application trends, the weekly report, system health and
the people who use the application. Everything is read through the application's own endpoints, so the same roles apply
(the weekly report, system stats and the user list are admin-only there, and here)."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict

from app.agentic.guardrails.output_guard import safe_text
from app.agentic.tools.base import Tool, ToolContext, ToolError, ToolOutput, number, obj, text

CORE = frozenset({"admin", "user", "manager", "evp"})
ADMIN = frozenset({"admin"})


def get_candidate_notes(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    cv_id = text(args.get("cv_id"), 60)
    if not cv_id:
        raise ToolError("cv_id is required. Search for the candidate first.")
    body = ctx.gateway.get(f"/api/cv/{cv_id}/note")
    notes = [{"by": text(n.get("hr_user"), 40), "note": safe_text(n.get("note"), 600), "updated": text(n.get("updated_at"), 10)} for n in (body.get("notes") or [])[:10]]
    card = {"type": "table", "title": "Notes on this candidate", "rows": [{"by": n["by"], "note": n["note"], "updated": n["updated"]} for n in notes]}
    return ToolOutput({"count": len(notes), "notes": notes}, card if notes else None, f"Notes read for cv_id={cv_id}: {len(notes)}")


def application_trends(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    days = number(args.get("days"), 14, 1, 60)
    body = ctx.gateway.get("/api/careers/admin/jobs-trends", days=days)
    series = body.get("series") or {}
    totals = sorted(((jid, sum(int(x or 0) for x in counts)) for jid, counts in series.items()), key=lambda kv: -kv[1])[:8]
    names: Dict[str, str] = {}
    if totals:
        listing = ctx.gateway.get("/api/careers/admin/jobs", limit=100, offset=0, include_inactive="true")
        for j in (listing.get("jobs") if isinstance(listing, dict) else listing) or []:
            names[str(j.get("job_id"))] = text(j.get("job_title"), 80)
    rows = [{"job": names.get(jid) or "A job", "applications": n} for jid, n in totals if n]
    everything = sum(n for _, n in totals)
    return ToolOutput({"days": days, "applications_in_period": everything, "top_jobs": rows},
                      {"type": "table", "title": f"Applications in the last {days} days", "rows": rows}, f"Trends read for {days} days")


def weekly_report(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    today = date.today()
    start, end = text(args.get("start_date"), 10) or (today - timedelta(days=6)).isoformat(), text(args.get("end_date"), 10) or today.isoformat()
    body = ctx.gateway.get("/api/careers/admin/reports/weekly", start_date=start, end_date=end)
    people = [{"recruiter": text(r.get("recruiter"), 40), "jobs_posted": r.get("jobs_posted")} for r in (body.get("recruiters_posted") or [])[:15]]
    return ToolOutput({"from": start, "to": end, "total_jobs_posted": body.get("total_jobs_posted"), "recruiters": people},
                      {"type": "table", "title": f"Jobs posted {start} to {end}: {body.get('total_jobs_posted', 0)}", "rows": people}, "Weekly report read")


def system_status(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    health = ctx.gateway.get("/api/health")
    services = {name: text((svc or {}).get("status"), 20) for name, svc in (health.get("services") or {}).items()}
    out: Dict[str, Any] = {"overall": text(health.get("status"), 20), "services": services}
    rows = [{"part": k, "status": v} for k, v in services.items()]
    if ctx.role == "admin":
        stats = (ctx.gateway.get("/api/system-stats").get("stats") or {}).get("database_stats") or {}
        out["database"] = {"cvs": stats.get("total_cvs"), "job_descriptions": stats.get("total_jds")}
        rows += [{"part": "CVs stored", "status": stats.get("total_cvs")}, {"part": "Job descriptions stored", "status": stats.get("total_jds")}]
    return ToolOutput(out, {"type": "table", "title": f"System status: {out['overall']}", "rows": rows}, "System status read")


def list_users(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    limit = number(args.get("limit"), 15, 1, 40)
    rows = [{"user": text(u.get("username"), 40), "role": text(u.get("role"), 20), "active": "yes" if u.get("is_active") else "no"}
            for u in (ctx.gateway.get("/api/admin/users") or [])]
    needle = text(args.get("query"), 40).lower()
    if needle:
        rows = [r for r in rows if needle in r["user"].lower() or needle in r["role"].lower()]
    return ToolOutput({"total": len(rows), "users": rows[:limit]}, {"type": "table", "title": f"Users ({len(rows)})", "rows": rows[:limit]}, f"{len(rows)} users read")


TOOLS = [
    Tool("get_candidate_notes", "Read the notes the team wrote on one candidate.", obj(cv_id={"type": "string"}, required=["cv_id"]), CORE, get_candidate_notes),
    Tool("application_trends", "How many applications came in over the last days, and for which jobs.", obj(days={"type": "integer", "description": "1 to 60, default 14."}), CORE, application_trends),
    Tool("weekly_report", "Admin: how many jobs each recruiter posted in a date range (default: the last 7 days).",
         obj(start_date={"type": "string", "description": "YYYY-MM-DD"}, end_date={"type": "string", "description": "YYYY-MM-DD"}), ADMIN, weekly_report),
    Tool("system_status", "Whether the application's services are healthy, and (admins) how many CVs and job descriptions are stored.", obj(), CORE, system_status),
    Tool("list_users", "Admin: the people who have an account, with their role.", obj(query={"type": "string"}, limit={"type": "integer"}), ADMIN, list_users),
]
