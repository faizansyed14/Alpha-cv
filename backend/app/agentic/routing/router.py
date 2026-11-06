"""Choosing the specialist. Cheapest method first, and every step stays inside what the person's role may use:

1. rules      keyword scores (intents.py). A clear winner is chosen with no model call.
2. sticky     a short follow-up ("yes", "make it shorter", "the first one") stays with the specialist of the last answer.
3. router     only when the rules are unsure: one tiny call to the ``router`` model, which must answer with a specialist name.
4. ask        when nothing fits, a clarifying question with clickable choices (fixed text, no model).

The router model can only pick from the specialists the role may use, and anything else it says is ignored.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import List, Optional

from app.agentic import models
from app.agentic.routing.intents import score
from app.agentic.specialists.base import Specialist

logger = logging.getLogger(__name__)

_STICKY_MAX_WORDS = 14
_TASKS = {"matching", "interview", "linkedin"}
_NEW_JOB = re.compile(r"\b(?:post|create|publish|draft|advertise)\b", re.I)
_STRONG = 3


@dataclass
class Route:
    specialist: Optional[str]
    how: str                       # rules | sticky | router | ask
    tokens: int = 0
    cost: float = 0.0


def _ask_model(message: str, allowed: List[Specialist]) -> tuple[Optional[str], int, float]:
    listing = "\n".join(f"- {s.name}: {s.description}" for s in allowed)
    messages = [
        {"role": "system", "content": "Pick the specialist that should handle the user's message. Reply with exactly one word: one of the names "
                                      "below, or none if none of them fits.\n" + listing},
        {"role": "user", "content": message[:600]},
    ]
    response = models.complete(messages, role="router", max_tokens=12)
    if response is None or not response.success:
        return None, 0, 0.0
    reply = ((response.data or {}).get("_text") or "").lower()
    tokens = int(response.tokens_in or 0) + int(response.tokens_out or 0)
    cost = float(response.cost_usd or 0.0)
    for s in allowed:
        if re.search(rf"\b{re.escape(s.name)}\b", reply):
            return s.name, tokens, cost
    return None, tokens, cost


def route(message: str, *, allowed: List[Specialist], previous: Optional[str], pending_draft: bool = False) -> Route:
    names = {s.name for s in allowed}
    scores = {k: v for k, v in score(message).items() if k in names}
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    top = ranked[0] if ranked else None
    second = ranked[1] if len(ranked) > 1 else None

    # a waiting job draft belongs to the jobs specialist: "yes", "change the title", "make it remote"
    if pending_draft and "jobs" in names and not (top and top[0] != "jobs" and top[1] >= _STRONG):
        return Route("jobs", "sticky")

    # a task that needs a pick (match / interview questions / a LinkedIn post) keeps going while the person looks things up for it:
    # "show me the JDs", "it engineer", "show me categories" are part of the same task, not a new request
    if previous in _TASKS and previous in names and top and top[0] in ("jobs", "candidates") and len(message.split()) <= 12 and not _NEW_JOB.search(message):
        return Route(previous, "sticky")

    if top and top[1] >= _STRONG and (second is None or top[1] > second[1]):
        return Route(top[0], "rules")

    if previous in names and len(message.split()) <= _STICKY_MAX_WORDS and not (top and top[1] >= _STRONG):
        return Route(previous, "sticky")

    if len(allowed) == 1:
        return Route(allowed[0].name, "rules")

    if top or len(message.split()) >= 3:
        picked, tokens, cost = _ask_model(message, allowed)
        if picked:
            return Route(picked, "router", tokens, cost)
        return Route(None, "ask", tokens, cost)
    return Route(None, "ask")
