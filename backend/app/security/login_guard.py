"""Login brute-force protection (Redis-backed).

Three counters, all expiring after LOGIN_LOCKOUT_SECONDS:

* per client IP, across all accounts: LOGIN_MAX_FAILED_ATTEMPTS_PER_IP failures refuse that address (credential stuffing: one try on
  thousands of accounts never trips a per-account counter, and every try would cost a password hash).

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
from app.security.logsafe import mask_email, security_event

logger = logging.getLogger(__name__)

_NS = "login_guard"


def _user(username: str) -> str:
    return (username or "").strip().lower()


def _ip_key(username: str, ip: str) -> str:
    return f"failed_login:{_user(username)}|{ip or 'unknown'}"


def _ip_total_key(ip: str) -> str:
    return f"failed_login_ip:{ip or 'unknown'}"


def _account_key(username: str) -> str:
    return f"failed_login_account:{_user(username)}"


def _attempts(cache, key: str) -> int:
    data = cache.get(key, namespace=_NS)
    return int(data.get("attempts", 0)) if data else 0


def check_lockout(username: str, ip: str = "") -> Tuple[bool, Optional[int]]:
    """Return (locked, seconds_remaining). locked=True => reject the attempt."""
    try:
        cache = get_redis_cache()
        if _attempts(cache, _ip_total_key(ip)) >= settings.LOGIN_MAX_FAILED_ATTEMPTS_PER_IP:
            security_event("login_locked", logging.ERROR, scope="ip_all_accounts", ip=ip)
            return True, settings.LOGIN_LOCKOUT_SECONDS
        if _attempts(cache, _ip_key(username, ip)) >= settings.LOGIN_MAX_FAILED_ATTEMPTS:
            security_event("login_locked", logging.ERROR, scope="account_and_ip", account=mask_email(username), ip=ip)
            return True, settings.LOGIN_LOCKOUT_SECONDS
        if _attempts(cache, _account_key(username)) >= settings.LOGIN_MAX_FAILED_ATTEMPTS_PER_ACCOUNT:
            security_event("login_locked", logging.ERROR, scope="account", account=mask_email(username), ip=ip)
            return True, settings.LOGIN_LOCKOUT_SECONDS
        return False, None
    except Exception as e:  # never block legitimate logins on a cache error
        logger.debug(f"login lockout check skipped: {e}")
        return False, None


def record_failure(username: str, ip: str = "") -> None:
    """Record a failed login; each lockout window starts on its first failure."""
    try:
        cache = get_redis_cache()
        for key in (_ip_key(username, ip), _account_key(username), _ip_total_key(ip)):
            data = cache.get(key, namespace=_NS) or {"attempts": 0}
            data["attempts"] = int(data.get("attempts", 0)) + 1
            cache.set(key, data, ttl_seconds=settings.LOGIN_LOCKOUT_SECONDS, namespace=_NS)
    except Exception as e:
        logger.debug(f"login failure not recorded (cache): {e}")


def _limits() -> dict:
    return {"ip": settings.LOGIN_MAX_FAILED_ATTEMPTS_PER_IP, "username_ip": settings.LOGIN_MAX_FAILED_ATTEMPTS,
            "account": settings.LOGIN_MAX_FAILED_ATTEMPTS_PER_ACCOUNT}


def current_blocks() -> dict:
    """What the admin screen shows: every failure counter that is alive, with whether it has reached its limit (so the sign-in is being
    refused) and how many seconds until it expires. ``kind``: ``ip`` = one address, across all accounts; ``username_ip`` = one account from one
    address; ``account`` = one account from any address."""
    limits = _limits()
    items = []
    for key, value, left in get_redis_cache().entries(_NS):
        attempts = int(value.get("attempts", 0)) if isinstance(value, dict) else 0
        if key.startswith("failed_login_ip:"):
            kind, username, ip = "ip", None, key[len("failed_login_ip:"):]
        elif key.startswith("failed_login_account:"):
            kind, username, ip = "account", key[len("failed_login_account:"):], None
        elif key.startswith("failed_login:"):
            username, _, ip = key[len("failed_login:"):].rpartition("|")
            kind = "username_ip"
        else:
            continue
        items.append({"kind": kind, "username": username, "ip": ip, "attempts": attempts, "limit": limits[kind],
                      "blocked": attempts >= limits[kind], "seconds_left": left})
    items.sort(key=lambda i: (not i["blocked"], -i["attempts"], i["kind"]))
    return {"lockout_seconds": settings.LOGIN_LOCKOUT_SECONDS, "limits": limits, "items": items}


def unlock(kind: str, username: Optional[str] = None, ip: Optional[str] = None) -> bool:
    """Clear one failure counter. True when the arguments name a counter this module keeps (it need not exist any more)."""
    cache = get_redis_cache()
    if kind == "ip" and ip:
        key = _ip_total_key(ip)
    elif kind == "account" and username:
        key = _account_key(username)
    elif kind == "username_ip" and username and ip:
        key = _ip_key(username, ip)
    else:
        return False
    cache.delete(key, namespace=_NS)
    return True


def reset(username: str, ip: str = "") -> None:
    """Clear this client's failure counter after a successful authentication."""
    try:
        get_redis_cache().delete(_ip_key(username, ip), namespace=_NS)
    except Exception:
        pass
