"""The bell: a signed-in person's own notifications. Everyone sees only their own; nobody can read or mark someone else's."""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.api.deps import require_user
from app.db.database import get_session
from app.models.user import User
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
    return {"unread": 0}


@router.post("/{notification_id}/read")
def read_one(notification_id: str, user: User = Depends(require_user), session: Session = Depends(get_session)) -> dict:
    if not notification_id or len(notification_id) > 36:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    svc.mark_read(session, user.id, notification_id)          # someone else's id changes nothing (and says nothing)
    return {"unread": svc.unread_count(session, user.id)}
