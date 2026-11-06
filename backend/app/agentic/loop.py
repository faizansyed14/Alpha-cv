"""The bounded tool loop: the model may ask for tools, we run them, it reads the results, and so on, within hard limits.

Limits (all in the settings): AGENTIC_MAX_STEPS model calls, AGENTIC_MAX_TOOLS_PER_STEP tools per call, AGENTIC_TOOL_RESULT_CHARS per
tool answer. Before EVERY model call the person's token budget is checked (usage.plan_call), the last step is made without
tools so an answer always comes out, and a repeated or failing call is answered with a hint instead of being run again. Two
unproductive steps in a row end the research.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from sqlmodel import Session

from app.agentic import models
from app.agentic.guardrails.output_guard import safe_text, wrap_tool_result
from app.agentic.specialists.base import Specialist
from app.agentic.tools.base import Tool, ToolContext, ToolError, ToolOutput
from app.agents import usage
from app.config.settings import settings

logger = logging.getLogger(__name__)


@dataclass
class LoopResult:
    text: str = ""
    cards: List[Dict[str, Any]] = field(default_factory=list)
    memos: List[str] = field(default_factory=list)
    trace: List[Dict[str, Any]] = field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    cost: float = 0.0
    model: str = ""
    steps: int = 0
    limit_message: str = ""        # the token budget stopped the turn: show this
    failed: bool = False           # the model could not be reached
    handoff: Optional[str] = None      # the skill the model passed the request to
    choices: List[str] = field(default_factory=list)      # names from the latest lookup, to offer as chips when the answer is a question


def _parse_args(call: Dict[str, Any]) -> Dict[str, Any]:
    raw = (call.get("function") or {}).get("arguments") or "{}"
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _brief(args: Dict[str, Any]) -> Dict[str, str]:
    return {str(k)[:30]: safe_text(v, 60) for k, v in list(args.items())[:6]}


def run(session: Session, spec: Specialist, tools: List[Tool], ctx: ToolContext, messages: List[Dict[str, Any]], already_spent: int = 0) -> LoopResult:
    result = LoopResult(model=models.model_for("act"))
    schemas = [t.schema() for t in tools]
    by_name = {t.name: t for t in tools}
    done_calls: set = set()
    stale = 0
    force_final = False

    for step in range(settings.AGENTIC_MAX_STEPS):
        last = force_final or step == settings.AGENTIC_MAX_STEPS - 1
        max_tokens, why_not = usage.plan_call(session, ctx.username, messages,
                                              in_flight=already_spent + result.tokens_in + result.tokens_out + ctx.spent_tokens)
        if why_not:
            result.limit_message = why_not
            return result
        response = models.complete(messages, role="act", max_tokens=max_tokens, tools=None if last else schemas)
        result.steps = step + 1
        if response is None or not response.success:
            result.failed = True
            return result
        result.tokens_in += int(response.tokens_in or 0)
        result.tokens_out += int(response.tokens_out or 0)
        result.cost += float(response.cost_usd or 0.0)
        result.model = response.model_used or result.model
        data = response.data or {}
        calls = [] if last else list(data.get("_tool_calls") or [])[:settings.AGENTIC_MAX_TOOLS_PER_STEP]
        if not calls:
            result.text = data.get("_text") or ""
            return result

        messages.append({"role": "assistant", "content": data.get("_text") or None, "tool_calls": calls})
        productive = False
        for call in calls:
            name = (call.get("function") or {}).get("name") or ""
            args = _parse_args(call)
            key = f"{name}:{json.dumps(args, sort_keys=True, default=str)}"
            tool = by_name.get(name)
            started = time.perf_counter()
            if tool is None:
                out = ToolOutput({"error": f"There is no tool called {name}."}, ok=False)
            elif key in done_calls:
                out = ToolOutput({"error": "You already made this exact call. Use its earlier result."}, ok=False)
            else:
                done_calls.add(key)
                try:
                    out = tool.handler(ctx, args)
                except ToolError as exc:
                    out = ToolOutput({"error": str(exc)}, ok=False)
                except Exception as exc:  # noqa: BLE001 - one broken tool must not break the turn
                    logger.error(f"Agentic tool {name} crashed: {str(exc)[:200]}", exc_info=True)
                    out = ToolOutput({"error": "That tool failed. Try another way or tell the person."}, ok=False)
            productive = productive or out.ok
            if out.card:
                result.cards.append(out.card)
            if out.memo:
                result.memos.append(out.memo)
            if out.choices:
                result.choices = list(out.choices)
            result.trace.append({"step": step + 1, "tool": name, "ok": out.ok, "ms": int((time.perf_counter() - started) * 1000), "args": _brief(args)})
            messages.append({"role": "tool", "tool_call_id": call.get("id") or f"call_{step}", "content":
                             wrap_tool_result(name, out.data, settings.AGENTIC_TOOL_RESULT_CHARS)})
        if ctx.handoff:
            result.handoff = ctx.handoff
            return result
        stale = 0 if productive else stale + 1
        if stale >= 2:
            force_final = True
    return result
