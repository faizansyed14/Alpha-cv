"""Interview Question Agent: /api/agents/interview/*  (about, conversations, chat)."""
from app.agents.interview import INTERVIEW_AGENT
from app.api.routers.agent_chat import build_agent_router

router = build_agent_router(INTERVIEW_AGENT)
