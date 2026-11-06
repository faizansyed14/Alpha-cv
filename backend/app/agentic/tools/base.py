"""What a tool is. Every tool is a plain function with a JSON schema, the roles that may use it, and a rule for what it returns:

* ``data``  what the MODEL sees (small, already cut and masked by the loop)
* ``card``  what the PERSON sees: built here from the tool's own data, never from the model's wording, so names, numbers
            and scores on screen are exactly what the application returned
* ``memo``  one line kept for later turns so the model remembers which ids it was shown
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set

from sqlmodel import Session


class ToolError(Exception):
    """A tool could not do its job. The message is safe to show the model and the person."""


@dataclass
class ToolOutput:
    data: Dict[str, Any]
    card: Optional[Dict[str, Any]] = None
    memo: str = ""
    ok: bool = True
    choices: Optional[List[str]] = None          # a few names the person may pick from (shown as chips, not as a big card)


@dataclass
class ToolContext:
    session: Session
    gateway: Any                                   # tools.gateway.ApiGateway
    username: str
    role: str
    message: str                                   # the person's message this turn
    pending_draft: Optional[Dict[str, Any]] = None  # a job draft shown in the previous message, if any
    confirmed: bool = False                        # the person said yes to that draft this turn
    specialist: str = ""                          # the skill that is running
    allowed_skills: List[str] = field(default_factory=list)   # the OTHER skills this person's role may be handed over to
    handoff: Optional[str] = None                  # set by switch_skill: the turn restarts with that skill
    show_lists: bool = False                       # the person ASKED to see a list; otherwise lookups stay off the screen
    attachment: Optional[Dict[str, Any]] = None    # a job description file attached this turn: ref, filename, text
    spent_tokens: int = 0                          # tokens used by tools' own model calls this turn
    spent_cost: float = 0.0
    seen_ids: Set[str] = field(default_factory=set)
    matches_run: int = 0
    proposed: int = 0                              # changes proposed this turn (one at a time)
    published: bool = False

    def see(self, *ids: Any) -> None:
        self.seen_ids.update(str(i) for i in ids if i)


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: Dict[str, Any]
    roles: frozenset
    handler: Callable[[ToolContext, Dict[str, Any]], ToolOutput]
    writes: bool = False                           # creates something or starts work (never deletes: no such tool exists)

    def schema(self) -> Dict[str, Any]:
        return {"type": "function", "function": {"name": self.name, "description": self.description, "parameters": self.parameters}}


def number(value: Any, default: int, low: int, high: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, n))


def text(value: Any, limit: int = 200) -> str:
    return " ".join(str(value or "").split())[:limit]


def obj(**properties: Any) -> Dict[str, Any]:
    """A small JSON-schema object. A property written as ("name", required=True) style is not needed: pass ``required`` in the dict."""
    required = properties.pop("required", [])
    return {"type": "object", "properties": properties, "required": list(required)}
