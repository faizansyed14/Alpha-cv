"""Lightweight online-presence tracking (Redis-backed).

Records the last time each user made an authenticated request. A user counts
as "online" while they've been seen within ``PRESENCE_TTL_SECONDS``; ``clear()``
(called on logout) drops them immediately. A 30-day "last seen" marker survives
the TTL so the admin page can show "last seen 5m ago" for offline users.

Implementation notes
--------------------
* A small Redis SET holds every username ever seen, so ``snapshot()`` is
  O(number of users) — it never SCANs the whole keyspace.
* Everything degrades to a no-op when Redis is unavailable.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict

from app.core.config import settings
from app.utils.redis_cache import get_redis_cache

logger = logging.getLogger(__name__)

_USERS_SET = "cv_app:presence:users"          # SET of usernames ever seen
_ONLINE_KEY = "cv_app:presence:online:"       # per-user TTL key -> "online now"
_LASTSEEN_KEY = "cv_app:presence:last:"       # per-user 30d key -> epoch
_LASTSEEN_TTL = 60 * 60 * 24 * 30


def ttl_seconds() -> int:
    return max(30, int(getattr(settings, "PRESENCE_TTL_SECONDS", 120)))


def touch(username: str) -> None:
    """Mark ``username`` as active right now (best-effort, one round-trip)."""
    if not username:
        return
    try:
        cache = get_redis_cache()
        if not cache.is_connected:
            return
        now = str(int(time.time()))
        pipe = cache.redis_client.pipeline()
        pipe.sadd(_USERS_SET, username)
        pipe.set(_ONLINE_KEY + username, now, ex=ttl_seconds())
        pipe.set(_LASTSEEN_KEY + username, now, ex=_LASTSEEN_TTL)
        pipe.execute()
    except Exception as e:  # pragma: no cover - presence must never break a request
        logger.debug(f"presence.touch({username}) failed: {e}")


def clear(username: str) -> None:
    """Drop the online marker immediately (logout). Keeps the last-seen value."""
    if not username:
        return
    try:
        cache = get_redis_cache()
        if cache.is_connected:
            cache.redis_client.delete(_ONLINE_KEY + username)
    except Exception as e:  # pragma: no cover
        logger.debug(f"presence.clear({username}) failed: {e}")


def snapshot() -> Dict[str, Dict[str, Any]]:
    """``{username: {"online": bool, "last_seen": epoch_int|None}}`` for every
    user seen in the last 30 days."""
    out: Dict[str, Dict[str, Any]] = {}
    try:
        cache = get_redis_cache()
        if not cache.is_connected:
            return out
        rc = cache.redis_client

        members = rc.smembers(_USERS_SET) or set()
        names = [m.decode() if isinstance(m, bytes) else m for m in members]
        if not names:
            return out

        pipe = rc.pipeline()
        for n in names:
            pipe.get(_ONLINE_KEY + n)
            pipe.get(_LASTSEEN_KEY + n)
        flat = pipe.execute()

        stale: list[str] = []
        for i, n in enumerate(names):
            online_val = flat[2 * i]
            last_val = flat[2 * i + 1]
            if online_val is None and last_val is None:
                stale.append(n)  # both keys expired — user hasn't been around in 30d
                continue
            try:
                ts = int(last_val) if last_val is not None else None
            except (TypeError, ValueError):
                ts = None
            out[n] = {"online": online_val is not None, "last_seen": ts}

        if stale:
            try:
                rc.srem(_USERS_SET, *stale)
            except Exception:
                pass
    except Exception as e:  # pragma: no cover
        logger.debug(f"presence.snapshot failed: {e}")
    return out
