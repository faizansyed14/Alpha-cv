"""Login brute-force protection (Redis-backed account lockout).

Enforces settings.LOGIN_MAX_FAILED_ATTEMPTS / LOGIN_LOCKOUT_SECONDS per
username. Fails open (allows the attempt) only if Redis is unavailable, so a
cache outage never locks everyone out — the global rate limiter still applies.
"""
import logging
from typing import Optional, Tuple

from app.core.config import settings
from app.utils.redis_cache import get_redis_cache

logger = logging.getLogger(__name__)

_NS = "login_guard"


def _key(username: str) -> str:
    return f"failed_login:{(username or '').strip().lower()}"


def check_lockout(username: str) -> Tuple[bool, Optional[int]]:
    """Return (locked, seconds_remaining). locked=True => reject the attempt."""
    try:
        cache = get_redis_cache()
        data = cache.get(_key(username), namespace=_NS)
        if not data:
            return False, None
        attempts = int(data.get("attempts", 0))
        if attempts >= settings.LOGIN_MAX_FAILED_ATTEMPTS:
            # Lockout auto-expires via the Redis key TTL (LOGIN_LOCKOUT_SECONDS).
            return True, settings.LOGIN_LOCKOUT_SECONDS
        return False, None
    except Exception as e:  # never block legitimate logins on a cache error
        logger.debug(f"login lockout check skipped: {e}")
        return False, None


def record_failure(username: str) -> None:
    """Record a failed login; the lockout window starts on the first failure."""
    try:
        cache = get_redis_cache()
        k = _key(username)
        data = cache.get(k, namespace=_NS) or {"attempts": 0}
        data["attempts"] = int(data.get("attempts", 0)) + 1
        cache.set(k, data, ttl_seconds=settings.LOGIN_LOCKOUT_SECONDS, namespace=_NS)
    except Exception as e:
        logger.debug(f"login failure not recorded (cache): {e}")


def reset(username: str) -> None:
    """Clear the failure counter after a successful authentication."""
    try:
        get_redis_cache().delete(_key(username), namespace=_NS)
    except Exception:
        pass
