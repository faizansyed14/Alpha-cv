"""The agents that exist. Adding one means a new package next to ``interview/`` and one line here."""
from typing import Dict, Optional

from app.agents.base import AgentSpec
from app.agents.interview import INTERVIEW_AGENT
from app.agents.linkedin import LINKEDIN_AGENT

AGENTS: Dict[str, AgentSpec] = {a.id: a for a in (INTERVIEW_AGENT, LINKEDIN_AGENT)}


def get_agent(agent_id: str) -> Optional[AgentSpec]:
    return AGENTS.get(agent_id)
