"""Which specialists exist and which of them a role may use."""
from __future__ import annotations

from typing import Dict, List, Optional

from app.agentic.specialists.base import Specialist
from app.agentic.specialists.catalog import ALL
from app.agentic.tools.base import Tool
from app.agentic.tools.registry import tools_for

BY_NAME: Dict[str, Specialist] = {s.name: s for s in ALL}


def get(name: str) -> Optional[Specialist]:
    return BY_NAME.get(name)


def available(role: str) -> List[Specialist]:
    return [s for s in ALL if role in s.roles]


def tools_of(spec: Specialist, role: str) -> List[Tool]:
    names = list(spec.tool_names)
    if len(available(role)) > 1:
        names.append("switch_skill")           # every skill can hand a request over to the skill it belongs to
    return tools_for(names, role)


def examples_for(role: str) -> List[str]:
    """One example request from each specialist the role can use, for chips and small-talk replies."""
    return [s.examples[0] for s in available(role)]


def capabilities(role: str) -> List[dict]:
    return [{"name": s.name, "label": s.label, "description": s.description, "examples": list(s.examples)} for s in available(role)]
