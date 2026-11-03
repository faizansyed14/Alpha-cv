"""Login brute-force protection (Redis-backed).

Two counters, both expiring after LOGIN_LOCKOUT_SECONDS:

* per (username, client IP): LOGIN_MAX_FAILED_ATTEMPTS failures lock that username *from that IP only*. Keying on the
  username alone let anyone lock any account (including admin) out with five bad passwords.
* per username, any IP: LOGIN_MAX_FAILED_ATTEMPTS_PER_ACCOUNT failures lock the account for everyone, so a guesser
  spread over many addresses is still stopped.

The client IP comes from the rate limiter, which only believes X-Forwarded-For from our own proxies. Fails open
(allows the attempt) only if Redis is unavailable, so a cache outage never locks everyone out.
"""
import logging
from typing import Optional, Tuple

from app.config.settings import settings
from app.providers.cache.redis import get_redis_cache

logger = logging.getLogger(__name__)

_NS = "login_guard"


def _user(username: str) -> str:
    return (username or "").strip().lower()


def _ip_key(username: str, ip: str) -> str:
    return f"failed_login:{_user(username)}|{ip or 'unknown'}"


def _account_key(username: str) -> str:
    return f"failed_login_account:{_user(username)}"


def _attempts(cache, key: str) -> int:
    data = cache.get(key, namespace=_NS)
    return int(data.get("attempts", 0)) if data else 0


def check_lockout(username: str, ip: str = "") -> Tuple[bool, Optional[int]]:
    """Return (locked, seconds_remaining). locked=True => reject the attempt."""
    try:
        cache = get_redis_cache()
        if _attempts(cache, _ip_key(username, ip)) >= settings.LOGIN_MAX_FAILED_ATTEMPTS:
            return True, settings.LOGIN_LOCKOUT_SECONDS
        if _attempts(cache, _account_key(username)) >= settings.LOGIN_MAX_FAILED_ATTEMPTS_PER_ACCOUNT:
            return True, settings.LOGIN_LOCKOUT_SECONDS
        return False, None
    except Exception as e:  # never block legitimate logins on a cache error
        logger.debug(f"login lockout check skipped: {e}")
        return False, None


def record_failure(username: str, ip: str = "") -> None:
    """Record a failed login; each lockout window starts on its first failure."""
    try:
        cache = get_redis_cache()
        for key in (_ip_key(username, ip), _account_key(username)):
            data = cache.get(key, namespace=_NS) or {"attempts": 0}
            data["attempts"] = int(data.get("attempts", 0)) + 1
            cache.set(key, data, ttl_seconds=settings.LOGIN_LOCKOUT_SECONDS, namespace=_NS)
    except Exception as e:
        logger.debug(f"login failure not recorded (cache): {e}")


def reset(username: str, ip: str = "") -> None:
    """Clear this client's failure counter after a successful authentication."""
    try:
        get_redis_cache().delete(_ip_key(username, ip), namespace=_NS)
    except Exception:
        pass
