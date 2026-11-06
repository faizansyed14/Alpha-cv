"""Endpoints shared by all AI agents: the list of agents, and reading the text of an uploaded job description.

Each agent's own endpoints (chat, conversations) are in ``interview_agent.py`` and ``linkedin_agent.py``.
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.agents import usage
from app.agents.registry import AGENTS
from app.agents.scope import MAX_MESSAGE_CHARS
from app.api.deps import require_admin, require_core_app
from app.config.settings import settings
from app.db.database import get_session
from app.ingestion.cv_parser import get_parsing_service
from app.models.user import User
from app.security.uploads import PUBLIC_CV_EXTENSIONS, secure_upload

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agents", tags=["AI agents"])


@router.get("")
async def list_agents(_: User = Depends(require_core_app)) -> List[Dict[str, Any]]:
    return [{"id": a.id, "name": a.name, "tagline": a.tagline, "examples": a.examples, "default_request": a.default_request,
             "max_jd_chars": settings.AGENT_MAX_JD_CHARS, "max_message_chars": MAX_MESSAGE_CHARS} for a in AGENTS.values()]


@router.get("/usage")
async def my_usage(user: User = Depends(require_core_app), session: Session = Depends(get_session)) -> Dict[str, Any]:
    """The signed-in person's tokens used today against their daily budget."""
    return await asyncio.to_thread(usage.usage_for, session, user.username)


class ResetRequestBody(BaseModel):
    reason: str = Field("", max_length=300)


@router.post("/usage/request-reset")
async def ask_for_reset(body: ResetRequestBody, user: User = Depends(require_core_app), session: Session = Depends(get_session)) -> Dict[str, Any]:
    """Ask an admin to reset the signed-in person's tokens for today. One waiting request at a time."""
    try:
        return await asyncio.to_thread(usage.request_reset, session, user.username, body.reason)
    except usage.UsageError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


@router.get("/admin/reset-requests")
async def reset_requests(_: User = Depends(require_admin), session: Session = Depends(get_session)) -> Dict[str, Any]:
    return await asyncio.to_thread(usage.reset_requests_overview, session)


@router.post("/admin/reset-requests/{request_id}/{decision}")
async def answer_reset_request(request_id: str, decision: str, admin: User = Depends(require_admin), session: Session = Depends(get_session)) -> Dict[str, Any]:
    """Admin: approve (resets that person's count) or reject a request."""
    if decision not in ("approve", "reject"):
        raise HTTPException(status_code=404, detail="Unknown decision")
    try:
        out = await asyncio.to_thread(usage.decide_request, session, request_id, admin.username, decision == "approve")
    except usage.UsageError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))
    logger.info(f"Admin {admin.username} {decision}d the token reset request of {out['username']}")
    return out


def _everyone_usage(session: Session) -> List[Dict[str, Any]]:
    people = session.exec(select(User.username, User.role)).all()
    rows = []
    for username, role in people:
        u = usage.usage_for(session, username)
        rows.append({"username": username, "role": role, **u})
    rows.sort(key=lambda r: (-r["used"], r["username"]))
    return rows


@router.get("/admin/usage")
async def everyone_usage(_: User = Depends(require_admin), session: Session = Depends(get_session)) -> Dict[str, Any]:
    """Admin: every person's token use today, and the global total against its ceiling."""
    users = await asyncio.to_thread(_everyone_usage, session)
    total = await asyncio.to_thread(usage.global_used_today, session)
    return {"limit_per_user": settings.AGENT_TOKENS_PER_USER_PER_DAY, "global_limit": settings.AGENT_TOKENS_GLOBAL_PER_DAY,
            "global_used": total, "users": users}


@router.post("/admin/usage/{username}/reset")
async def reset_user_usage(username: str, admin: User = Depends(require_admin), session: Session = Depends(get_session)) -> Dict[str, Any]:
    """Admin: zero one person's count for today. Recorded (who, when, how much), never deleting what was spent."""
    exists = await asyncio.to_thread(lambda: session.exec(select(User.username).where(User.username == username)).first())
    if exists is None:
        raise HTTPException(status_code=404, detail="User not found")
    logger.info(f"Admin {admin.username} reset the agent token count of {username}")
    return await asyncio.to_thread(usage.reset_usage, session, username, admin.username)


@router.post("/extract-text")
async def extract_text(file: UploadFile = File(...), kind: str = "jd", _: User = Depends(require_core_app)) -> Dict[str, Any]:
    """The text of an uploaded job description (or a CV, with ?kind=cv), for the chat. Nothing is stored: the text goes back to the page."""
    kind = "cv" if kind == "cv" else "jd"
    data, name, _kind = await secure_upload(file, PUBLIC_CV_EXTENSIONS)
    ext = os.path.splitext(name)[1].lower() or ".pdf"

    def read() -> str:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp.write(data)
            path = tmp.name
        try:
            return str(get_parsing_service().process_document(path, kind).get("raw_text") or "")
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    try:
        text = (await asyncio.to_thread(read)).strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Could not read uploaded job description {name}: {exc}")
        raise HTTPException(status_code=400, detail="That file could not be read. Try another file or paste the text.")
    if len(text) < 80:
        raise HTTPException(status_code=400, detail="Not enough text could be read from that file. Try another file or paste the text.")
    return {"filename": name, "text": text[: settings.AGENT_MAX_JD_CHARS], "chars": min(len(text), settings.AGENT_MAX_JD_CHARS),
            "truncated": len(text) > settings.AGENT_MAX_JD_CHARS}
