"""Hand-off: a skill that gets a request that belongs to another skill passes it on, instead of telling the person "I can't".

Routing by keywords is right most of the time, not always. This is the safety net that makes the assistant behave like ONE
assistant: the model calls ``switch_skill``, the turn restarts with that skill's own instructions and tools (once per turn),
and the person never sees the seam. Only skills the person's role may use can be chosen.
"""
from __future__ import annotations

from typing import Any, Dict

from app.agentic.tools.base import Tool, ToolContext, ToolError, ToolOutput, obj, text

ROLES = frozenset({"admin", "user", "manager", "evp"})


def switch_skill(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    skill = text(args.get("skill"), 30).lower()
    if skill not in ctx.allowed_skills:
        raise ToolError("You cannot switch to that. The skills you can switch to are: " + (", ".join(ctx.allowed_skills) or "none") + ".")
    ctx.handoff = skill
    return ToolOutput({"status": "switching", "to": skill}, memo=f"Handed over to the {skill} skill")


TOOLS = [
    Tool("switch_skill", "Hand this request to another of your skills when it belongs there (for example a request about matching, categories, candidates, "
         "interview questions, a LinkedIn post, job postings or the tracker). Use it instead of saying you cannot do something. Call it with no other tool.",
         obj(skill={"type": "string", "description": "The skill name to hand over to."}, reason={"type": "string"}, required=["skill"]), ROLES, switch_skill),
]
