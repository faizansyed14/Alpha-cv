"""Admin tools (read only): who is using the AI agents' tokens, and which reset requests are waiting.

Answering a request is a confirmed action (``propose_token_answer``); the cards also link to the Agent usage page.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from app.agentic.tools.base import Tool, ToolContext, ToolOutput, number, obj, text

ROLES = frozenset({"admin"})
_PAGE = {"label": "Open Agent usage", "href": "/agents/usage"}
_SNAPSHOT = ("These numbers are a snapshot of this moment. Tokens are used all the time (including by this very chat), so a later read can be higher: "
             "just give the latest value and say it has changed. Never say an earlier answer was wrong because a number moved.")


def _when(iso: Any) -> str:
    """2026-11-05T07:39:12Z -> '5 Nov 07:39 UTC' (the raw timestamp is hard to read)."""
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(timezone.utc)
        return f"{d.day} {d:%b %H:%M} UTC"
    except ValueError:
        return text(iso, 16)


def _now() -> str:
    return f"{datetime.now(timezone.utc):%H:%M} UTC"


def token_usage_overview(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    limit = number(args.get("limit"), 10, 1, 25)
    body = ctx.gateway.get("/api/agents/admin/usage")
    users = [{"user": text(u.get("username"), 40), "role": text(u.get("role"), 20), "tokens_used": u.get("used"), "of": u.get("limit"),
              "percent": u.get("percent"), "answers": u.get("calls")} for u in (body.get("users") or [])[:limit]]
    summary = {"per_user_limit": body.get("limit_per_user"), "everyone_used": body.get("global_used"), "everyone_limit": body.get("global_limit")}
    return ToolOutput({**summary, "top_users": users, "as_of": _now(), "note": _SNAPSHOT},
                      {"type": "table", "title": "AI token usage today", "rows": users, "link": _PAGE}, "Token usage read")


def pending_token_requests(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    body = ctx.gateway.get("/api/agents/admin/reset-requests")
    waiting = (body.get("pending") or [])[:25]
    rows = [{"user": text(r.get("username"), 40), "used": r.get("used"), "of": r.get("limit"), "percent": r.get("percent"),
             "reason": text(r.get("reason"), 120) or "none given", "asked": _when(r.get("requested_at"))} for r in waiting]
    refs = [{"user": r["user"], "ref": str(w.get("id"))} for r, w in zip(rows, waiting)]
    return ToolOutput({"waiting": len(rows), "requests": rows, "refs": refs, "as_of": _now(),
                       "note": _SNAPSHOT + " To approve or reject one, call propose_token_answer with its ref: the admin then confirms on screen."},
                      {"type": "table", "title": "Token reset requests waiting", "rows": rows, "link": _PAGE}, f"{len(rows)} reset requests waiting")


TOOLS = [
    Tool("token_usage_overview", "Admin: how many AI tokens each person has used today, and the shared total.", obj(limit={"type": "integer"}), ROLES, token_usage_overview),
    Tool("pending_token_requests", "Admin: the token reset requests that are waiting for an answer.", obj(), ROLES, pending_token_requests),
]
