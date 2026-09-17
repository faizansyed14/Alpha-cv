"""Login notice popup.

An admin can publish a single global notice that is shown to every non-admin user
when they use the app, and can be dismissed (X) or removed/deactivated by the admin
at any time. The notice is stored in Redis (persistent, no TTL) so it survives
restarts but needs no DB migration.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.deps.auth import require_user, require_admin
from app.models.user import User
from app.utils.redis_cache import get_redis_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Notice"])

_NOTICE_NS = "app"
_NOTICE_KEY = "notice:current"


class NoticeIn(BaseModel):
    message: str = Field(..., max_length=4000)
    active: bool = True


def _get_notice() -> Optional[dict]:
    try:
        return get_redis_cache().get(_NOTICE_KEY, namespace=_NOTICE_NS)
    except Exception:
        return None


@router.get("/notice")
def get_active_notice(user: User = Depends(require_user)):
    """Active notice for the current user.

    Admins never get the popup (they manage it). Returns {"notice": null} when there
    is no active notice.
    """
    notice = _get_notice()
    if not notice or not notice.get("active"):
        return {"notice": None}
    if (getattr(user, "role", "") or "").lower() == "admin":
        return {"notice": None}
    return {"notice": notice}


@router.get("/admin/notice")
def admin_get_notice(_: User = Depends(require_admin)):
    """Current notice (active or not) for the admin editor."""
    return {"notice": _get_notice()}


@router.put("/admin/notice")
def admin_set_notice(data: NoticeIn, user: User = Depends(require_admin)):
    """Create/update the global notice. A new id is issued on every change so a
    previously-dismissed notice re-appears for users when the admin updates it."""
    message = (data.message or "").strip()
    notice = {
        "id": uuid.uuid4().hex,
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
