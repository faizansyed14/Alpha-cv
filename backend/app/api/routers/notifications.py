"""The bell: a signed-in person's own notifications. Everyone sees only their own; nobody can read or mark someone else's.

``/stream`` is the live line to the browser (server-sent events): it says "look again" the moment something for this person is saved,
so the bell does not have to keep asking. See app/services/live.py.
"""
import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import require_user
from app.db.database import get_session
from app.config.settings import settings
from app.models.user import User
from app.services import live
from app.services import notifications as svc

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    limit: int = Query(20, ge=1, le=50),
    before: Optional[datetime] = Query(None, description="Older than this (the created_at of the last one shown): the next page"),
    unread_only: bool = False,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> dict:
    """The person's notifications of the last 30 days, newest first, and how many are unread."""
    if before is not None and before.tzinfo is not None:
        before = before.astimezone(timezone.utc).replace(tzinfo=None)      # stored times are UTC without a zone
    return svc.list_for(session, user.id, limit=limit, before=before, unread_only=unread_only)


@router.get("/unread-count")
def unread_count(user: User = Depends(require_user), session: Session = Depends(get_session)) -> dict:
    """What the bell polls: the unread count, and the newest notification's id (the bell chimes once for each new one)."""
    return {"unread": svc.unread_count(session, user.id), "latest_id": svc.latest_id(session, user.id)}


@router.post("/read-all")
def read_all(user: User = Depends(require_user), session: Session = Depends(get_session)) -> dict:
    svc.mark_read(session, user.id)
    live.publish([(user.id, "read")])                         # the person's other tabs and devices take their count down too
    return {"unread": 0}


@router.post("/{notification_id}/read")
def read_one(notification_id: str, user: User = Depends(require_user), session: Session = Depends(get_session)) -> dict:
    if not notification_id or len(notification_id) > 36:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if svc.mark_read(session, user.id, notification_id):     # someone else's id changes nothing (and says nothing)
        live.publish([(user.id, "read")])
    return {"unread": svc.unread_count(session, user.id)}


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


@router.get("/stream")
async def stream(request: Request, user: User = Depends(require_user), session: Session = Depends(get_session)) -> StreamingResponse:
    """The live line: ``ready`` once, then ``notification`` / ``read`` the moment something changes for this person, and a ``ping`` every
    LIVE_HEARTBEAT_SECONDS so proxies keep the connection and the tab knows it is alive. It ends after LIVE_STREAM_MAX_SECONDS and the tab
    opens a new one, which checks the sign-in again (a deactivated account or an expired token stops there). The database is not held
    while the line is open."""
    user_id = user.id
    await run_in_threadpool(session.close)                   # the sign-in check is done: give its connection back to the pool now
    queue = live.hub.subscribe(user_id)
    if queue is None:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many open live connections")
    heartbeat = max(1.0, float(settings.LIVE_HEARTBEAT_SECONDS))
    ends_at = time.monotonic() + max(heartbeat, float(settings.LIVE_STREAM_MAX_SECONDS))

    async def events():
        try:
            yield "retry: 3000\n\n" + _event("ready", {})
            while time.monotonic() < ends_at:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=min(heartbeat, max(0.1, ends_at - time.monotonic())))
                    yield _event("read" if item.get("kind") == "read" else "notification", item)
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    yield _event("ping", {})
        finally:
            live.hub.unsubscribe(user_id, queue)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})
