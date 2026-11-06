"""LinkedIn Job Post Agent: /api/agents/linkedin/*  (about, conversations, chat)."""
from app.agents.linkedin import LINKEDIN_AGENT
from app.api.routers.agent_chat import build_agent_router

router = build_agent_router(LINKEDIN_AGENT)
