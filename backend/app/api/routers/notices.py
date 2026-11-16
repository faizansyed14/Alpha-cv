"""Login notice popup.

An admin can publish a single global notice that is shown to every non-admin user when they use the app. A person can close it with the X
(it comes back at their next sign-in) or acknowledge it with the thumbs-up (it is then never shown to them again, and the admin sees who has
acknowledged it and who has not). The admin can show, edit, hide or remove the notice at any time.

The message is kept in Redis (persistent, no TTL) and has an id that changes whenever its text does, so an edited notice has to be
acknowledged again. A person's acknowledgement is two columns on their ``user`` row: the id of the notice they acknowledged and when. There
is one notice at a time, so an id that is not the current one simply means "has not acknowledged this notice".
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, update
from sqlmodel import Session, select

from app.api.deps import require_user, require_admin
from app.db.database import get_session
from app.models.user import User
from app.providers.cache.redis import get_redis_cache
from app.security.logsafe import security_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Notice"])

_NOTICE_NS = "app"
_NOTICE_KEY = "notice:current"


class NoticeIn(BaseModel):
    message: str = Field(..., max_length=4000)
    active: bool = True


class AcknowledgeIn(BaseModel):
    notice_id: str = Field(..., min_length=1, max_length=64)


def _get_notice() -> Optional[dict]:
    try:
        return get_redis_cache().get(_NOTICE_KEY, namespace=_NOTICE_NS)
    except Exception:
        return None


def _is_admin(user: User) -> bool:
    return (getattr(user, "role", "") or "").lower() == "admin"


def _iso_utc(moment: Optional[datetime]) -> Optional[str]:
    """A UTC time the browser reads correctly (the database holds naive UTC times)."""
    return moment.isoformat() + "Z" if moment else None


@router.get("/notice")
def get_active_notice(user: User = Depends(require_user), session: Session = Depends(get_session)):
    """The notice to show the current user, or ``{"notice": null}``: when there is none, when it is hidden, for admins (they manage it), and
    when this person has already acknowledged it."""
    notice = _get_notice()
    if not notice or not notice.get("active"):
        return {"notice": None}
    if _is_admin(user):
        return {"notice": None}
    acknowledged = session.exec(select(User.notice_ack_id).where(User.id == user.id)).first()
    if acknowledged and acknowledged == notice.get("id"):
        return {"notice": None}
    return {"notice": notice}


@router.post("/notice/acknowledge")
def acknowledge_notice(data: AcknowledgeIn, user: User = Depends(require_user), session: Session = Depends(get_session)):
    """The thumbs-up: this person has read the notice. Once; asking again changes nothing. The notice must still be the current one: if the
    admin edited or removed it meanwhile the answer is 409 and the page fetches the new one."""
    notice = _get_notice()
    if not notice or not notice.get("active") or notice.get("id") != data.notice_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This notice has changed or been removed.")
    if _is_admin(user):
        return {"acknowledged": False}                       # admins never see the popup, so there is nothing for them to acknowledge
    # one statement: the time of the first acknowledgement is kept when a second tab answers at the same moment
    result = session.execute(update(User).where(User.id == user.id, or_(User.notice_ack_id.is_(None), User.notice_ack_id != data.notice_id))
                             .values(notice_ack_id=data.notice_id, notice_ack_at=datetime.utcnow()))
    session.commit()
    if result.rowcount:
        security_event("notice_acknowledged", user=user.username)
    return {"acknowledged": True}


@router.get("/admin/notice")
def admin_get_notice(_: User = Depends(require_admin)):
    """Current notice (active or not) for the admin editor."""
    return {"notice": _get_notice()}


@router.get("/admin/notice/acknowledgements")
def admin_notice_acknowledgements(_: User = Depends(require_admin), session: Session = Depends(get_session)):
    """Who has clicked OK on the current notice and who has not: every active non-admin account (the people it is shown to), the ones who have
    not acknowledged first, then the others with the newest first."""
    notice = _get_notice()
    if not notice:
        return {"notice": None, "summary": {"total": 0, "acknowledged": 0, "pending": 0}, "users": []}
    people = session.exec(select(User).where(User.is_active == True, User.role != "admin")).all()  # noqa: E712
    users = []
    for p in people:
        done = bool(p.notice_ack_id) and p.notice_ack_id == notice["id"]
        users.append({
            "id": p.id, "username": p.username, "email": p.email, "role": p.role, "location": p.location,
            "acknowledged": done, "acknowledged_at": _iso_utc(p.notice_ack_at) if done else None,
        })
    pending = sorted((u for u in users if not u["acknowledged"]), key=lambda u: u["username"].lower())
    answered = sorted((u for u in users if u["acknowledged"]), key=lambda u: u["username"].lower())
    answered.sort(key=lambda u: u["acknowledged_at"] or "", reverse=True)          # newest first
    return {"notice": notice, "summary": {"total": len(users), "acknowledged": len(answered), "pending": len(pending)}, "users": pending + answered}


@router.put("/admin/notice")
def admin_set_notice(data: NoticeIn, user: User = Depends(require_admin)):
    """Create/update the global notice. A new id is issued when the TEXT changes, so an edited notice reaches everybody again (those who had
    acknowledged the old one must acknowledge it again). Showing or hiding the same text keeps its id, so nobody is asked twice."""
    message = (data.message or "").strip()
    current = _get_notice()
    same_text = bool(current and message and current.get("message") == message and current.get("id"))
    notice = {
        "id": current["id"] if same_text else uuid.uuid4().hex,
        "message": message,
        "active": bool(data.active) and bool(message),
        "updated_at": datetime.utcnow().isoformat(),
        "updated_by": getattr(user, "username", None),
    }
    try:
        get_redis_cache().set(_NOTICE_KEY, notice, ttl_seconds=None, namespace=_NOTICE_NS)
    except Exception as e:
        logger.error(f"Failed to store notice: {e}")
    return {"notice": notice}


@router.delete("/admin/notice")
def admin_clear_notice(_: User = Depends(require_admin)):
    """Remove the notice popup for all users."""
    try:
        get_redis_cache().delete(_NOTICE_KEY, namespace=_NOTICE_NS)
    except Exception:
        pass
    return {"notice": None}
