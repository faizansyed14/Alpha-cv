"""Proposals and their answers.

``propose`` builds the card a tool puts on screen. ``pending`` finds the proposal that is waiting (only the latest assistant
message counts, so a stray "yes" later in the chat can never run an old change). ``confirm`` and ``cancel`` answer it in code.
"""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlmodel import Session

from app.agentic.actions.catalog import ACTIONS
from app.agentic.tools.base import ToolContext, ToolError, ToolOutput, text
from app.agents import store
from app.agents.runtime import TurnResult

logger = logging.getLogger(__name__)


def propose(ctx: ToolContext, kind: str, rows: Sequence[Tuple[str, Any]], payload: Dict[str, Any], *, title: Optional[str] = None,
            warning: str = "") -> ToolOutput:
    """The card for a change that waits for the person. Nothing has been changed yet."""
    action = ACTIONS.get(kind)
    if action is None or ctx.role not in action.roles:
        raise ToolError("Your role is not allowed to do that.")
    if ctx.proposed >= 1:
        return ToolOutput({"error": "One change at a time. Wait for the person to answer the change already on screen."}, ok=False)
    ctx.proposed += 1
    card = {"type": "action", "id": uuid.uuid4().hex, "kind": kind, "specialist": ctx.specialist, "title": title or action.label,
            "rows": [{"label": text(k, 40), "value": text(v, 400)} for k, v in rows if v not in (None, "")],
            "payload": payload, "warning": warning or ("This sends something to other people." if action.outward else "")}
    return ToolOutput({"status": "waiting_for_confirmation",
                       "note": "The change is on the person's screen with Confirm and Cancel buttons. NOTHING has been changed yet: do not say it is done. "
                               "Say in one short sentence what will happen and ask them to confirm."},
                      card, f"Proposed: {card['title']}")


def pending(rows: List[Any]) -> Optional[Dict[str, Any]]:
    """The proposal waiting for an answer: the latest assistant message must carry it."""
    last = next((m for m in reversed(rows) if m.role == "assistant"), None)
    if last is None or last.status != "ok":
        return None
    for card in (last.meta or {}).get("cards") or []:
        if card.get("type") == "action" and card.get("kind") in ACTIONS:
            return card
    return None


def confirm(session: Session, user: Any, gateway: Any, conv: Any, user_row: Any, card: Dict[str, Any]) -> TurnResult:
    """The person pressed Confirm (or said yes) to the proposal saved in their conversation: run it now, in code."""
    started = time.perf_counter()
    action = ACTIONS[card["kind"]]
    ok, line = True, ""
    try:
        if user.role not in action.roles:
            raise ToolError("Your role is not allowed to do that.")
        line = action.run(gateway, dict(card.get("payload") or {}), user.username)
    except ToolError as exc:
        ok, line = False, str(exc)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Agentic action {action.kind} crashed for {user.username}: {str(exc)[:200]}", exc_info=True)
        ok, line = False, "The application did not accept that change."
    ms = int((time.perf_counter() - started) * 1000)
    logger.info(f"agentic action user={user.username} role={user.role} kind={action.kind} ok={ok}")
    reply = f"Done. {line}" if ok else f"I couldn't do that: {line} Nothing was changed."
    cards = [{"type": "action_done", "title": card.get("title"), "text": line, "ok": ok}]
    meta = {"specialist": card.get("specialist") or "jobs", "route": "confirm_action", "cards": cards, "action": {"id": card.get("id"), "kind": action.kind, "ok": ok},
            "trace": [{"step": 1, "tool": action.kind, "ok": ok, "ms": ms, "args": {}}], "context": reply, "suggestions": []}
    row = store.append_message(session, conv.id, "assistant", reply, status="ok", meta=meta, latency_ms=ms)
    return TurnResult(conv, user_row, row)


def cancel(session: Session, conv: Any, user_row: Any, card: Dict[str, Any]) -> TurnResult:
    reply = "Okay, I won't do that. Nothing was changed."
    meta = {"specialist": card.get("specialist") or "jobs", "route": "cancel_action", "cards": [], "action": {"id": card.get("id"), "kind": card.get("kind"), "cancelled": True},
            "context": reply, "suggestions": []}
    row = store.append_message(session, conv.id, "assistant", reply, status="ok", meta=meta)
    return TurnResult(conv, user_row, row)
