"""The chat endpoints every agent has, built once for a given agent spec.

``interview_agent.py`` and ``linkedin_agent.py`` each call ``build_agent_router`` for their own agent, so each agent has its own
URL prefix and its own router. Only GET and POST exist: no route edits or deletes a conversation or a message (the database
refuses it too), and the agents have no tools that change anything.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.agents import store, usage
from app.agents.base import AgentSpec
from app.agents.runtime import AgentError, Refusal, handle_turn
from app.agents.scope import MAX_MESSAGE_CHARS
from app.api.deps import require_core_app
from app.db.database import get_session
from app.models.user import User
from app.store import get_store


class ChatRequest(BaseModel):
    message: str = Field("", max_length=MAX_MESSAGE_CHARS * 2)
    conversation_id: Optional[str] = Field(None, max_length=64)
    # the job description, for the FIRST message of a conversation (later messages reuse the stored copy)
    jd_source: Literal["library", "pasted", "uploaded"] = "pasted"
    jd_id: Optional[str] = Field(None, max_length=128)
    jd_text: Optional[str] = Field(None, max_length=200_000)
    jd_title: Optional[str] = Field(None, max_length=200)
    # an optional candidate CV (agents that use one only), for the FIRST message of a conversation
    cv_source: Literal["none", "library", "uploaded"] = "none"
    cv_id: Optional[str] = Field(None, max_length=128)
    cv_text: Optional[str] = Field(None, max_length=200_000)
    cv_title: Optional[str] = Field(None, max_length=200)


def message_dto(m) -> Dict[str, Any]:
    return {"id": m.id, "seq": m.seq, "role": m.role, "content": m.content, "status": m.status, "blocked_reason": m.blocked_reason,
            "meta": m.meta, "model": m.model, "tokens": int(m.tokens_in or 0) + int(m.tokens_out or 0), "created_at": m.created_at}


def conversation_dto(c) -> Dict[str, Any]:
    return {"id": c.id, "agent": c.agent, "title": c.title, "jd_id": c.jd_id, "jd_title": c.jd_title, "jd_source": c.jd_source,
            "cv_title": c.cv_title, "created_at": c.created_at}


def _library_jd(jd_id: str) -> Dict[str, str]:
    """The text and title of a job description that is already in the library (read only)."""
    doc = get_store().jd_document(jd_id)
    if not doc:
        raise AgentError("That job description was not found.", 404)
    detail = get_store().jd_detail(jd_id) or {}
    return {"text": doc["raw_text"] or "", "title": str(detail.get("job_title") or doc.get("filename") or "")}


def _library_cv(cv_id: str) -> Dict[str, str]:
    """The text and the candidate's name of a CV that is already in the library (read only)."""
    doc = get_store().candidate_document(cv_id)
    if not doc:
        raise AgentError("That CV was not found.", 404)
    return {"text": doc["raw_text"] or "", "title": str(doc.get("full_name") or doc.get("filename") or "")}


def build_agent_router(agent: AgentSpec) -> APIRouter:
    router = APIRouter(prefix=f"/api/agents/{agent.id}", tags=[agent.name])

    @router.get("")
    async def about(_: User = Depends(require_core_app)) -> Dict[str, Any]:
        return {"id": agent.id, "name": agent.name, "tagline": agent.tagline, "examples": agent.examples,
                "default_request": agent.default_request, "max_message_chars": MAX_MESSAGE_CHARS, "accepts_cv": agent.accepts_cv}

    @router.get("/conversations")
    async def list_conversations(user: User = Depends(require_core_app), session: Session = Depends(get_session)):
        return await asyncio.to_thread(store.list_conversations, session, agent.id, user.username)

    @router.get("/conversations/{conversation_id}")
    async def get_conversation(conversation_id: str, user: User = Depends(require_core_app), session: Session = Depends(get_session)):
        conv = await asyncio.to_thread(store.get_conversation, session, conversation_id, user.username)
        if conv is None or conv.agent != agent.id:
            raise HTTPException(status_code=404, detail="Conversation not found")
        rows = await asyncio.to_thread(store.messages, session, conv.id)
        return {"conversation": conversation_dto(conv), "messages": [message_dto(m) for m in rows]}

    @router.post("/conversations/{conversation_id}/hide")
    async def hide_conversation(conversation_id: str, user: User = Depends(require_core_app), session: Session = Depends(get_session)):
        """'Delete chat' in the interface: removes it from the person's list. The record itself is kept (see store.hide_conversation)."""
        ok = await asyncio.to_thread(store.hide_conversation, session, conversation_id, user.username)
        if not ok:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"ok": True}

    @router.post("/chat")
    async def chat(req: ChatRequest, user: User = Depends(require_core_app), session: Session = Depends(get_session)):
        jd_text, jd_title = req.jd_text, req.jd_title
        cv_text, cv_title = req.cv_text, req.cv_title
        try:
            if req.cv_source != "none" and not agent.accepts_cv:
                raise AgentError(f"The {agent.name} does not use CVs.")
            if not req.conversation_id and req.jd_source == "library":
                if not req.jd_id:
                    raise AgentError("Choose a job description first.")
                lib = await asyncio.to_thread(_library_jd, req.jd_id)
                jd_text, jd_title = lib["text"], lib["title"] or jd_title
            if not req.conversation_id and req.cv_source == "library":
                if not req.cv_id:
                    raise AgentError("Choose a CV first.")
                lib_cv = await asyncio.to_thread(_library_cv, req.cv_id)
                cv_text, cv_title = lib_cv["text"], lib_cv["title"] or cv_title
            if req.cv_source == "none":
                cv_text = None
            result = await asyncio.to_thread(
                handle_turn, session, agent_id=agent.id, username=user.username, message=req.message,
                conversation_id=req.conversation_id, jd_text=jd_text, jd_id=req.jd_id if req.jd_source == "library" else None,
                jd_title=jd_title, jd_source=req.jd_source, cv_text=cv_text,
                cv_id=req.cv_id if req.cv_source == "library" else None, cv_title=cv_title)
        except AgentError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc))
        used = await asyncio.to_thread(usage.usage_for, session, user.username)
        if isinstance(result, Refusal):
            # refused before any conversation existed: answered with the fixed text, nothing to store
            return {"conversation": None, "user_message": None,
                    "assistant_message": {"id": None, "seq": 0, "role": "assistant", "content": result.reply, "status": "blocked",
                                          "blocked_reason": result.reason, "meta": None, "model": None, "tokens": 0, "created_at": datetime.utcnow()},
                    "usage": used}
        return {"conversation": conversation_dto(result.conversation), "user_message": message_dto(result.user_message),
                "assistant_message": message_dto(result.assistant_message), "usage": used}

    return router
