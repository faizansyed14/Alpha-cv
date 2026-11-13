"""Every tool that exists. A specialist lists tool NAMES; this registry turns them into the tools that person's role may use.

There is deliberately no tool in this package that deletes or removes anything. Tools never change data themselves either: the
``propose_*`` tools only put a change on screen for the person to confirm (``agentic/actions``). ``assert_no_destructive_tools``
runs at import time and in the tests, so adding a deleting tool by accident would fail loudly, and a tool that is allowed to write
must be named ``propose_*`` or be one of the few create/start tools listed in ``WRITING_TOOLS``.
"""
from __future__ import annotations

from typing import Dict, Iterable, List

from app.agentic.tools import admin, candidates, generation, handoff, insights, jobs, matching, proposals, tracker, tracker_changes
from app.agentic.tools.base import Tool

ALL_TOOLS: Dict[str, Tool] = {t.name: t for module in (candidates, jobs, matching, generation, admin, insights, proposals, tracker, tracker_changes, handoff) for t in module.TOOLS}

_DESTRUCTIVE = ("delete", "remove", "erase", "purge", "wipe", "drop", "destroy", "truncate", "clear")
# tools that create or start something (and are guarded in code); every other writing tool is a propose_* tool
WRITING_TOOLS = frozenset({"publish_job_post", "read_job_file", "draft_job_post", "run_matching", "generate_interview_questions", "generate_linkedin_post"})


def assert_no_destructive_tools() -> None:
    bad = [name for name in ALL_TOOLS if any(word in name.lower() for word in _DESTRUCTIVE)]
    assert not bad, f"destructive tools are not allowed in Agentic mode: {bad}"
    loose = [n for n, t in ALL_TOOLS.items() if t.writes and not n.startswith("propose_") and n not in WRITING_TOOLS]
    assert not loose, f"a writing tool must be a propose_* tool (confirmed by the person): {loose}"


assert_no_destructive_tools()


def tools_for(names: Iterable[str], role: str) -> List[Tool]:
    """The named tools that ``role`` may use, in the order given."""
    return [ALL_TOOLS[n] for n in names if n in ALL_TOOLS and role in ALL_TOOLS[n].roles]
