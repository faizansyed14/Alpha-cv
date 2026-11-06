"""Tracker tools (read only): the candidate tracker's rows and follow-ups, scoped by the application to what the person may see.

Every role has these, including tracker-only accounts (account managers), who have no other Agentic tools.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.agentic.tools.base import Tool, ToolContext, ToolOutput, number, obj, text

ROLES = frozenset({"admin", "user", "manager", "evp", "account_manager"})
_PRIVATE = ("email", "phone", "mobile", "contact", "password", "token")


def _flat(row: Dict[str, Any]) -> Dict[str, Any]:
    """The candidate tracker returns {candidate: {...}, application: {...}}: bring both up to one level, application fields winning."""
    flat: Dict[str, Any] = {}
    for key in ("candidate", "application"):
        if isinstance(row.get(key), dict):
            flat.update({k: v for k, v in row[key].items() if not (key == "application" and k in ("id", "candidate_id"))})
    flat.update({k: v for k, v in row.items() if not isinstance(v, dict)})
    return flat


def _slim(rows: Any, limit: int) -> List[Tuple[Dict[str, Any], str]]:
    """(what is shown, the row's ref). The ref lets a later, confirmed change point at the row; it is never shown to the person."""
    out: List[Tuple[Dict[str, Any], str]] = []
    for row in (rows if isinstance(rows, list) else [])[:limit]:
        if not isinstance(row, dict):
            continue
        app_row, person = (row.get("application") if isinstance(row.get("application"), dict) else {}), (row.get("candidate") if isinstance(row.get("candidate"), dict) else {})
        ref = str(app_row.get("id") or person.get("id") or row.get("id") or "")
        flat = _flat(row)
        item = {k: (text(v, 80) if isinstance(v, str) else v) for k, v in flat.items()
                if isinstance(v, (str, int, float, bool)) and not any(p in k.lower() for p in _PRIVATE) and not k.endswith("_id") and k != "id"
                and not k.endswith("_at")}
        out.append((dict(list(item.items())[:10]), ref))
    return out


def _table(title: str, rows: List[Tuple[Dict[str, Any], str]]) -> ToolOutput:
    shown = [r for r, _ in rows]
    return ToolOutput({"shown": len(rows), "rows": [{**r, "ref": ref} for r, ref in rows]}, {"type": "table", "title": title, "rows": shown}, f"{title}: {len(rows)} rows read")


def tracker_candidates(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    limit = number(args.get("limit"), 12, 1, 25)
    return _table("Tracker candidates", _slim(ctx.gateway.get("/api/tracker/candidate-rows"), limit))


def tracker_follow_ups(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    limit = number(args.get("limit"), 12, 1, 25)
    return _table("Follow-ups", _slim(ctx.gateway.get("/api/tracker/follow-ups"), limit))


def tracker_job_openings(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    limit = number(args.get("limit"), 12, 1, 25)
    return _table("Job openings", _slim(ctx.gateway.get("/api/tracker/job-openings"), limit))


_LIMIT = obj(limit={"type": "integer", "description": "How many rows, at most 25."})
TOOLS = [
    Tool("tracker_candidates", "Read the candidate tracker rows: who is at which stage.", _LIMIT, ROLES, tracker_candidates),
    Tool("tracker_follow_ups", "Read the tracker's follow-ups that are due or open.", _LIMIT, ROLES, tracker_follow_ups),
    Tool("tracker_job_openings", "Read the tracker's job openings.", _LIMIT, ROLES, tracker_job_openings),
]
