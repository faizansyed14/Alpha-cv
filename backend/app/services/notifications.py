"""In-app notifications: making them, reading them and keeping the table small.

* ``notify`` adds notifications in the CALLER'S transaction (inside a savepoint), so a notification exists only if the change it reports
  was saved, and a failure to notify never undoes or breaks that change.
* Only the last NOTIFICATION_RETENTION_DAYS (30) are ever returned or counted, and ``purge`` (run every hour by the background worker)
  deletes older ones and anything beyond NOTIFICATION_MAX_PER_USER per person. So the table holds at most 30 days, whatever happens.
* Nobody is notified about what they did themselves.
* Once the caller's transaction COMMITS, the people notified are told at once in their open tabs (``app.services.live``): the bell
  updates without waiting for its next check. A rolled-back change tells nobody.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import delete, event, func, text, update
from sqlalchemy.orm import Session as OrmSession
from sqlmodel import Session, select

from app.config.settings import settings
from app.models.notification import Notification
from app.models.user import User

logger = logging.getLogger(__name__)


def _cutoff() -> datetime:
    return datetime.utcnow() - timedelta(days=max(1, settings.NOTIFICATION_RETENTION_DAYS))


def _cut(text: Optional[str], size: int) -> Optional[str]:
    if text is None:
        return None
    text = " ".join(str(text).split())
    return (text[: size - 1] + "…") if len(text) > size else (text or None)


def notify(session: Session, user_ids: Iterable[Optional[str]], kind: str, title: str, *, body: Optional[str] = None,
           link: Optional[str] = None, actor: Optional[User] = None) -> int:
    """Add one notification per person (no one twice, never the person who did it, only active accounts). Not committed here: it is
    saved with the caller's change. Returns how many were added; a failure is logged and returns 0."""
    actor_id, actor_name = getattr(actor, "id", None), getattr(actor, "username", None)
    ids = {i for i in user_ids if i} - {actor_id}
    if not ids:
        return 0
    try:
        with session.begin_nested():
            active = set(session.exec(select(User.id).where(User.id.in_(ids), User.is_active == True)).all())   # noqa: E712
            for uid in active:
                session.add(Notification(user_id=uid, kind=kind, title=_cut(title, 200) or kind, body=_cut(body, 500),
                                         link=_cut(link, 300), actor=actor_name))
        session.info.setdefault(_LIVE_KEY, set()).update((uid, kind) for uid in active)     # told live once the change is committed
        return len(active)
    except Exception:  # noqa: BLE001 - a notification is never worth failing the change it reports
        logger.exception("Could not add a %s notification", kind)
        return 0


_LIVE_KEY = "live_notify"


@event.listens_for(OrmSession, "after_commit")
def _tell_live_after_commit(session: OrmSession) -> None:
    """The notifications of this transaction are saved: tell the people in their open tabs now (never before the commit, so a tab never
    looks for a notification that is not there yet)."""
    events = session.info.pop(_LIVE_KEY, None)
    if events:
        from app.services import live

        try:
            live.publish(events)
        except Exception:  # noqa: BLE001 - the notification is saved; the bell finds it at its next check
            logger.warning("Could not send the live notification event", exc_info=True)


@event.listens_for(OrmSession, "after_rollback")
def _forget_live_after_rollback(session: OrmSession) -> None:
    session.info.pop(_LIVE_KEY, None)


def role_ids(session: Session, role: str) -> List[str]:
    """The active accounts of a role (the admins hear about new bug reports, the EVPs about closures). Like ``notify``, a failure is
    logged and gives nobody: it never breaks the change being reported (the query runs in a savepoint, so the transaction stays usable)."""
    try:
        with session.begin_nested():
            return list(session.exec(select(User.id).where(User.role == role, User.is_active == True)).all())   # noqa: E712
    except Exception:  # noqa: BLE001
        logger.exception("Could not look up the %s accounts to notify", role)
        return []


def admin_ids(session: Session) -> List[str]:
    return role_ids(session, "admin")


def user_id_by_username(session: Session, username: Optional[str]) -> Optional[str]:
    """The account of a username (a bug report keeps the reporter's username), or None; never raises, as ``admin_ids``."""
    if not username:
        return None
    try:
        with session.begin_nested():
            return session.exec(select(User.id).where(User.username == username)).first()
    except Exception:  # noqa: BLE001
        logger.exception("Could not look up the person to notify")
        return None


def view(n: Notification) -> Dict[str, Any]:
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "link": n.link, "actor": n.actor,
            "created_at": n.created_at.isoformat() + "Z", "read": n.read_at is not None}


def unread_count(session: Session, user_id: str) -> int:
    return int(session.exec(select(func.count()).select_from(Notification).where(
        Notification.user_id == user_id, Notification.read_at.is_(None), Notification.created_at >= _cutoff())).one())


def latest_id(session: Session, user_id: str) -> Optional[str]:
    """The newest notification's id: the bell plays its sound once per new id (and once across open tabs)."""
    return session.exec(select(Notification.id).where(Notification.user_id == user_id, Notification.created_at >= _cutoff())
                        .order_by(Notification.created_at.desc(), Notification.id.desc()).limit(1)).first()


def list_for(session: Session, user_id: str, limit: int = 20, before: Optional[datetime] = None, unread_only: bool = False) -> Dict[str, Any]:
    conds = [Notification.user_id == user_id, Notification.created_at >= _cutoff()]
    if before is not None:
        conds.append(Notification.created_at < before)
    if unread_only:
        conds.append(Notification.read_at.is_(None))
    rows = list(session.exec(select(Notification).where(*conds).order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit + 1)).all())
    return {"items": [view(n) for n in rows[:limit]], "has_more": len(rows) > limit, "unread": unread_count(session, user_id)}


def mark_read(session: Session, user_id: str, notification_id: Optional[str] = None) -> int:
    """Mark one notification (or, without an id, all of them) of this person as read. Returns how many changed; another person's
    notification is never touched."""
    q = update(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    if notification_id is not None:
        q = q.where(Notification.id == notification_id)
    changed = session.execute(q.values(read_at=datetime.utcnow())).rowcount or 0
    session.commit()
    return int(changed)


def purge(engine: Any) -> int:
    """Delete notifications older than the retention period and, per person, any beyond the newest NOTIFICATION_MAX_PER_USER.
    Returns how many were deleted."""
    with Session(engine) as s:
        # one clean-up at a time, however many workers or servers run it: the others skip this round (PostgreSQL; the lock ends with the
        # transaction)
        if engine.dialect.name == "postgresql" and not s.execute(text("SELECT pg_try_advisory_xact_lock(hashtext('notification_purge'))")).scalar():
            return 0
        removed = s.execute(delete(Notification).where(Notification.created_at < _cutoff())).rowcount or 0
        cap = max(1, settings.NOTIFICATION_MAX_PER_USER)
        over = s.exec(select(Notification.user_id).group_by(Notification.user_id).having(func.count() > cap)).all()
        for uid in over:
            keep = select(Notification.id).where(Notification.user_id == uid).order_by(Notification.created_at.desc(), Notification.id.desc()).limit(cap)
            removed += s.execute(delete(Notification).where(Notification.user_id == uid, Notification.id.notin_(keep))).rowcount or 0
        s.commit()
    return int(removed)
