"""Agentic mode API: /api/agentic/*

One chat endpoint, the person's own conversation history, and what their role can do. Only GET and POST exist: there is no
route that edits or deletes anything (a chat is "deleted" from the list with an append-only hide marker, like the agent chats).
The person's own bearer token is passed down so every tool acts with THEIR permissions.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.agentic import orchestrator, uploads
from app.agentic.tools import matching, pages
from app.agentic.tools.base import ToolError
from app.agentic.tools.gateway import ApiGateway
from app.agentic.guardrails.input_guard import MAX_MESSAGE_CHARS
from app.agentic.specialists import registry as specialists
from app.agents import store, usage
from app.agents.runtime import AgentError, Refusal
from app.api.deps import get_current_user, require_core_app
from app.api.routers.agent_chat import conversation_dto, message_dto
from app.config.settings import settings
from app.db.database import get_session
from app.models.user import User
from app.security.uploads import PUBLIC_CV_EXTENSIONS, secure_upload

router = APIRouter(prefix="/api/agentic", tags=["Agentic mode"])


class ChatRequest(BaseModel):
    message: str = Field("", max_length=MAX_MESSAGE_CHARS * 2)
    conversation_id: Optional[str] = Field(None, max_length=64)
    selection: Optional[Dict[str, Any]] = None                   # the picks from a card (for example the match setup): validated server side
    attachment_ref: Optional[str] = Field(None, max_length=64)      # a file staged with POST /uploads (a job description to post)


def _enabled() -> None:
    if not settings.AGENTIC_ENABLED:
        raise HTTPException(status_code=404, detail="Agentic mode is switched off.")


@router.get("/capabilities")
async def capabilities(user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """What this person's role can ask Agentic mode to do."""
    _enabled()
    skills = specialists.capabilities(user.role)
    return {"role": user.role, "username": user.username, "skills": skills, "examples": specialists.examples_for(user.role)}


@router.get("/conversations")
async def list_conversations(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _enabled()
    return await asyncio.to_thread(store.list_conversations, session, orchestrator.AGENT_ID, user.username)


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _enabled()
    conv = await asyncio.to_thread(store.get_conversation, session, conversation_id, user.username)
    if conv is None or conv.agent != orchestrator.AGENT_ID:
        raise HTTPException(status_code=404, detail="Conversation not found")
    rows = await asyncio.to_thread(store.messages, session, conv.id)
    return {"conversation": conversation_dto(conv), "messages": [message_dto(m) for m in rows]}


@router.post("/conversations/{conversation_id}/hide")
async def hide_conversation(conversation_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """'Delete chat' in the interface: it leaves the person's list; the record itself is kept."""
    _enabled()
    ok = await asyncio.to_thread(store.hide_conversation, session, conversation_id, user.username)
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


def _token(request: Request) -> str:
    header = request.headers.get("authorization") or ""
    return header.split(" ", 1)[1].strip() if header.lower().startswith("bearer ") else ""


class MoreRequest(BaseModel):
    tool: str = Field(..., max_length=40)
    args: Dict[str, Any] = Field(default_factory=dict)
    offset: int = Field(0, ge=0, le=10_000_000)
    cursor: Optional[str] = Field(None, max_length=2000)


@router.post("/cards/more")
async def more_rows(req: MoreRequest, request: Request, user: User = Depends(require_core_app)) -> Dict[str, Any]:
    """"Show more" under a list: the next page, read straight from the application's own API as the signed-in person. No model call,
    so paging through a million CVs costs no tokens. Only the list tools can be paged."""
    _enabled()
    if req.tool not in pages.PAGEABLE:
        raise HTTPException(status_code=404, detail="That list cannot be paged.")
    gateway = ApiGateway(_token(request), request.client.host if request.client else None)
    try:
        page = await asyncio.to_thread(pages.fetch, gateway, req.tool, req.args, req.offset, req.cursor)
    except ToolError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"rows": page.rows, "total": page.total, "page": pages.descriptor(req.tool, req.args, page)}


@router.get("/match-status/{job_id}")
async def match_status(job_id: str, request: Request, user: User = Depends(require_core_app)) -> Dict[str, Any]:
    """Progress (and finally the results) of a matching run, for the card on screen to poll. Read from the application's own match
    API as the signed-in person; no model is called, so waiting costs no tokens."""
    _enabled()
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,64}", job_id):
        raise HTTPException(status_code=404, detail="Unknown matching run.")
    gateway = ApiGateway(_token(request), request.client.host if request.client else None)
    try:
        return await asyncio.to_thread(matching.match_status, gateway, job_id)
    except ToolError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/uploads")
async def upload_job_description(file: UploadFile = File(...), user: User = Depends(require_core_app)) -> Dict[str, Any]:
    """Attach a job description file to the chat. It is validated like any upload, read, and kept privately for up to two hours;
    it is only posted when the person confirms the draft the assistant shows."""
    _enabled()
    data, name, _kind = await secure_upload(file, PUBLIC_CV_EXTENSIONS)
    try:
        staged = await asyncio.to_thread(uploads.stage, user.username, data, name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="That file could not be read. Try another file or paste the text.")
    return {"ref": staged.ref, "filename": staged.filename, "chars": staged.chars}


@router.post("/chat")
async def chat(req: ChatRequest, request: Request, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _enabled()
    token = _token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Please sign in again.")
    principal = orchestrator.Principal(username=user.username, role=user.role, token=token, client_ip=request.client.host if request.client else None)
    try:
        result = await asyncio.to_thread(orchestrator.handle_turn, session, user=principal, message=req.message, conversation_id=req.conversation_id,
                                         attachment_ref=req.attachment_ref, selection=req.selection)
    except AgentError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))
    used = await asyncio.to_thread(usage.usage_for, session, user.username)
    if isinstance(result, Refusal):
        return {"conversation": None, "user_message": None, "usage": used,
                "assistant_message": {"id": None, "seq": 0, "role": "assistant", "content": result.reply, "status": "blocked",
                                      "blocked_reason": result.reason, "meta": ({"suggestions": result.suggestions} if result.suggestions else None),
                                      "model": None, "tokens": 0, "created_at": datetime.utcnow()}}
    return {"conversation": conversation_dto(result.conversation), "user_message": message_dto(result.user_message),
            "assistant_message": message_dto(result.assistant_message), "usage": used}
