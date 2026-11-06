"""What the agents spend, and the checks that keep the bill bounded.

The only meter is TOKENS (input + output of every answered call), read straight from the saved history, so the number a
person sees is exactly what was recorded and cannot drift from it. A person's count for the day is

    tokens in their answered messages since the LATEST of (00:00 UTC today, the last time an admin reset them)

An admin reset adds one row to ``agent_usage_reset`` (append-only); nothing that was spent is changed or hidden.

Checks that reduce the risk of the cost growing:
  1. per-person daily budget (``AGENT_TOKENS_PER_USER_PER_DAY``), checked BEFORE the call
  2. the call's input is estimated first; if the room left cannot hold it plus a useful answer, no call is made
  3. the answer's ``max_tokens`` is the room left today (up to the model's own output limit); there is no smaller per-answer cap,
     so a long request ("20 questions") is written in full, and an answer that still runs out of room is flagged as cut off
  4. one request at a time per person, so parallel clicks cannot all pass the check and overshoot together
  5. a global daily ceiling (``AGENT_TOKENS_GLOBAL_PER_DAY``) across everyone, as a circuit breaker
  6. small prompts by design: job text capped, only the last answered turn is sent back, greetings never reach the model
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlmodel import Session, select

from app.config.settings import settings
from app.models.agent import AgentConversation, AgentMessage, AgentResetDecision, AgentResetRequest, AgentUsageReset


# ------------------------------------------------------------------------------------------------------ the budget
def day_start(now: Optional[datetime] = None) -> datetime:
    now = now or datetime.utcnow()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def last_reset(session: Session, username: str) -> Optional[AgentUsageReset]:
    return session.exec(select(AgentUsageReset).where(AgentUsageReset.username == username, AgentUsageReset.reset_at >= day_start())
                        .order_by(AgentUsageReset.reset_at.desc()).limit(1)).first()


def _spent(session: Session, since: datetime, username: Optional[str] = None):
    stmt = select(func.coalesce(func.sum(AgentMessage.tokens_in + AgentMessage.tokens_out), 0),
                  func.coalesce(func.sum(AgentMessage.cost_usd), 0.0),
                  func.count(AgentMessage.id).filter(AgentMessage.role == "assistant", AgentMessage.tokens_in + AgentMessage.tokens_out > 0)) \
        .where(AgentMessage.created_at >= since)
    if username is not None:
        stmt = stmt.join(AgentConversation, AgentConversation.id == AgentMessage.conversation_id).where(AgentConversation.username == username)
    tokens, cost, calls = session.exec(stmt).one()
    return int(tokens or 0), float(cost or 0.0), int(calls or 0)


def usage_for(session: Session, username: str) -> Dict[str, Any]:
    """What one person has used today against their budget (this is what the page shows)."""
    reset = last_reset(session, username)
    since = reset.reset_at if reset else day_start()
    used, cost, calls = _spent(session, since, username)
    limit = int(settings.AGENT_TOKENS_PER_USER_PER_DAY)
    request = reset_request_state(session, username)
    return {
        "limit": limit, "used": used, "remaining": max(0, limit - used), "percent": min(100, round(100 * used / limit)) if limit else 100,
        "calls": calls, "cost_usd": round(cost, 5),
        "resets_at": _iso(day_start() + timedelta(days=1)),
        "last_reset_at": _iso(reset.reset_at) if reset else None, "last_reset_by": reset.reset_by if reset else None,
        "reset_request": request,
    }


def global_used_today(session: Session) -> int:
    return _spent(session, day_start())[0]


def reset_usage(session: Session, username: str, admin: str) -> Dict[str, Any]:
    """Zero one person's count. Any request of theirs that is still waiting is answered 'approved' in the same step."""
    before = usage_for(session, username)
    session.add(AgentUsageReset(username=username, reset_by=admin, tokens_cleared=before["used"]))
    for r in _pending_requests(session, username):
        session.add(AgentResetDecision(request_id=r.id, decision="approved", decided_by=admin))
    session.commit()
    return usage_for(session, username)


# ---------------------------------------------------------------------------------- asking an admin for a reset
class UsageError(Exception):
    """A request that cannot be done; the message is safe to show and ``status`` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _pending_requests(session: Session, username: Optional[str] = None) -> List[AgentResetRequest]:
    stmt = select(AgentResetRequest).where(AgentResetRequest.id.not_in(select(AgentResetDecision.request_id)))
    if username is not None:
        stmt = stmt.where(AgentResetRequest.username == username)
    return list(session.exec(stmt.order_by(AgentResetRequest.requested_at)).all())


def reset_request_state(session: Session, username: str) -> Optional[Dict[str, Any]]:
    """The person's latest request: waiting, or decided within the last day (older decisions are not worth showing)."""
    last = session.exec(select(AgentResetRequest).where(AgentResetRequest.username == username)
                        .order_by(AgentResetRequest.requested_at.desc()).limit(1)).first()
    if last is None:
        return None
    decision = session.exec(select(AgentResetDecision).where(AgentResetDecision.request_id == last.id)).first()
    if decision is None:
        return {"status": "pending", "requested_at": _iso(last.requested_at), "decided_at": None, "decided_by": None}
    if datetime.utcnow() - decision.decided_at > timedelta(hours=24):
        return None
    return {"status": decision.decision, "requested_at": _iso(last.requested_at), "decided_at": _iso(decision.decided_at),
            "decided_by": decision.decided_by}


def request_reset(session: Session, username: str, reason: str = "") -> Dict[str, Any]:
    if _pending_requests(session, username):
        raise UsageError("You already have a request waiting for an admin.", 409)
    if usage_for(session, username)["used"] <= 0:
        raise UsageError("You haven't used any tokens today, so there is nothing to reset.", 400)
    session.add(AgentResetRequest(username=username, reason=(reason or "").strip()[:300]))
    session.commit()
    return usage_for(session, username)


def reset_requests_overview(session: Session) -> Dict[str, Any]:
    """For the admin page: who is waiting, and the last few decisions."""
    waiting = []
    for r in _pending_requests(session):
        u = usage_for(session, r.username)
        waiting.append({"id": r.id, "username": r.username, "reason": r.reason, "requested_at": _iso(r.requested_at),
                        "used": u["used"], "limit": u["limit"], "percent": u["percent"]})
    rows = session.exec(select(AgentResetDecision, AgentResetRequest).join(AgentResetRequest, AgentResetRequest.id == AgentResetDecision.request_id)
                        .order_by(AgentResetDecision.decided_at.desc()).limit(15)).all()
    recent = [{"id": req.id, "username": req.username, "reason": req.reason, "requested_at": _iso(req.requested_at),
               "decision": dec.decision, "decided_by": dec.decided_by, "decided_at": _iso(dec.decided_at)} for dec, req in rows]
    return {"pending": waiting, "recent": recent}


def decide_request(session: Session, request_id: str, admin: str, approve: bool) -> Dict[str, Any]:
    req = session.get(AgentResetRequest, request_id)
    if req is None:
        raise UsageError("Request not found.", 404)
    if session.exec(select(AgentResetDecision).where(AgentResetDecision.request_id == request_id)).first() is not None:
        raise UsageError("That request has already been answered.", 409)
    if approve:
        reset_usage(session, req.username, admin)          # resets the count and marks this request approved
    else:
        session.add(AgentResetDecision(request_id=request_id, decision="rejected", decided_by=admin))
        session.commit()
    return {"ok": True, "username": req.username, "decision": "approved" if approve else "rejected"}


def estimate_tokens(messages: List[Dict[str, str]]) -> int:
    """A cautious input estimate (about 3.5 characters per token) so the check can run before the call."""
    def size(m: Dict[str, Any]) -> int:
        calls = m.get("tool_calls") or []                       # an assistant message that asks for tools has no text, only calls
        return len(m.get("content") or "") + sum(len(str(c.get("function") or "")) for c in calls) + 12

    return int(sum(size(m) for m in messages) / 3.5) + 20


def plan_call(session: Session, username: str, messages: List[Dict[str, str]], in_flight: int = 0) -> tuple[int, str]:
    """Decide whether a call may be made. Returns (max_tokens for the answer, "") or (0, the message to show the person)."""
    if global_used_today(session) >= settings.AGENT_TOKENS_GLOBAL_PER_DAY:
        return 0, "The AI agents have reached their shared limit for today. Please try again tomorrow, or ask an admin."
    u = usage_for(session, username)
    u["remaining"] = max(0, u["remaining"] - max(0, in_flight))       # earlier calls of this same turn are not saved yet
    if u["remaining"] <= 0:
        return 0, f"You've used today's {u['limit']:,} tokens. The count resets at 00:00 UTC, or an admin can reset it now."
    need_in = estimate_tokens(messages)
    room_for_answer = u["remaining"] - need_in
    if room_for_answer < settings.AGENT_MIN_OUTPUT_TOKENS:
        return 0, (f"This request needs about {need_in + settings.AGENT_MIN_OUTPUT_TOKENS:,} tokens but you have {u['remaining']:,} left today. "
                   "Try a shorter request, or wait for the reset.")
    return min(settings.AGENT_OUTPUT_CEILING_TOKENS, room_for_answer), ""


# ------------------------------------------------------------------------------------- one request at a time per person
_busy: Dict[str, float] = {}
_busy_lock = threading.Lock()


def begin_request(username: str) -> bool:
    """True if this person has no other agent request running (Redis, shared by every worker; process-local without it)."""
    ttl = int(settings.AGENT_TIMEOUT_SECONDS) + 30
    try:
        from app.providers.cache.redis import get_redis_cache

        cache = get_redis_cache()
        client = cache.redis_client if cache.is_connected else None
        if client is not None:
            return bool(client.set(f"cv_app:agents:busy:{username}", "1", nx=True, ex=ttl))
    except Exception:  # noqa: BLE001 - fall back to the process-local guard
        pass
    now = time.time()
    with _busy_lock:
        if _busy.get(username, 0) > now:
            return False
        _busy[username] = now + ttl
        return True


def end_request(username: str) -> None:
    try:
        from app.providers.cache.redis import get_redis_cache

        cache = get_redis_cache()
        client = cache.redis_client if cache.is_connected else None
        if client is not None:
            client.delete(f"cv_app:agents:busy:{username}")
    except Exception:  # noqa: BLE001
        pass
    with _busy_lock:
        _busy.pop(username, None)
