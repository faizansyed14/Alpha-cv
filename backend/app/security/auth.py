import hashlib
import logging
import os
import threading
import time
import uuid
from contextlib import contextmanager

from fastapi import HTTPException
from passlib.context import CryptContext
import jwt
from jwt import InvalidTokenError
from datetime import datetime, timedelta
from app.config.settings import settings

# Support both argon2 and bcrypt for password verification
# bcrypt is needed for existing passwords, argon2 for new ones
# Disable bcrypt bug detection to avoid false positives
pwd_context = CryptContext(
    schemes=["argon2", "bcrypt"], 
    deprecated="auto",
    bcrypt__ident="2b"  # Use bcrypt 2b identifier
)
ALGO = "HS256"

# Hashing a password costs ~0.1 s of CPU on purpose. Sign-in is open to the internet, so an attacker's wrong passwords would
# otherwise queue for every CPU and thread the API has. At most this many hash at once per process; a caller that cannot
# get a slot within a few seconds is told to retry (503) instead of waiting behind the flood.
_HASH_SLOTS = threading.BoundedSemaphore(int(os.getenv("PASSWORD_HASH_CONCURRENCY", "4")))


class HashingBusy(HTTPException):
    def __init__(self):
        super().__init__(status_code=503, detail="The server is busy. Please try again in a moment.", headers={"Retry-After": "5"})


@contextmanager
def _hash_slot():
    if not _HASH_SLOTS.acquire(timeout=3):
        raise HashingBusy()
    try:
        yield
    finally:
        _HASH_SLOTS.release()


def hash_password(pw: str) -> str:
    with _hash_slot():
        return pwd_context.hash(pw)

def verify_password(pw: str, pw_hash: str) -> bool:
    with _hash_slot():
        return _verify_password(pw, pw_hash)

def _verify_password(pw: str, pw_hash: str) -> bool:
    try:
        # For bcrypt hashes, handle the bug detection issue
        if pw_hash and pw_hash.startswith("$2"):
            # Import bcrypt directly to avoid passlib's bug detection
            try:
                import bcrypt
                # Extract the salt and hash from the stored hash
                # Format: $2b$12$salt22charshash31chars
                if len(pw_hash) >= 60:
                    # Verify using bcrypt directly
                    pw_bytes = pw.encode('utf-8')
                    hash_bytes = pw_hash.encode('utf-8')
                    return bcrypt.checkpw(pw_bytes, hash_bytes)
            except ImportError:
                # Fallback to passlib if bcrypt not available
                pass
            except Exception as e:
                import logging
                logger = logging.getLogger(__name__)
                logger.debug(f"Direct bcrypt verification failed: {e}, falling back to passlib")
        
        # Use passlib for argon2 or as fallback
        return pwd_context.verify(pw, pw_hash)
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(f"Password verification error: {e}")
        return False

_DUMMY_HASH: str | None = None


def burn_password_check(pw: str) -> None:
    """Spend the same time a real password check takes. Called when the account does not exist so the response time
    does not tell an attacker which emails are registered."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = pwd_context.hash(uuid.uuid4().hex)
    with _hash_slot():
        try:
            pwd_context.verify(pw or "", _DUMMY_HASH)
        except Exception:
            pass


def create_access_token(sub: str, role: str) -> str:
    now = datetime.utcnow()
    exp = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRES_MIN)
    # jti makes every token unique: without it two logins in the same second produced the SAME token, so logging out
    # and straight back in handed you a token that was already revoked.
    payload = {"sub": sub, "role": role, "exp": exp, "iat": now, "jti": uuid.uuid4().hex, "alg": ALGO}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGO)

def decode_token(token: str) -> dict:
    """
    Decode and verify JWT token with signature validation.
    
    Security: The jwt.decode() call with verify_signature=True and algorithms=[ALGO]
    automatically rejects:
    - Tokens with invalid signatures
    - Tokens using 'none' algorithm (not in allowed algorithms)
    - Tokens using any algorithm other than the specified one
    - Expired tokens
    """
    try:
        # Decode with signature verification - this automatically rejects:
        # - Tokens with 'none' algorithm (not in allowed algorithms list)
        # - Tokens with invalid signatures
        # - Tokens using algorithms other than ALGO
        decoded = jwt.decode(
            token, 
            settings.SECRET_KEY, 
            algorithms=[ALGO],  # Only allow HS256 - automatically rejects 'none' and other algorithms
            options={
                "verify_signature": True,  # Always verify signature
                "verify_exp": True,  # Verify expiration
                "require": ["exp", "sub", "role"]  # Require these claims
            }
        )
    except jwt.ExpiredSignatureError:
        raise InvalidTokenError("Token expired")
    except jwt.InvalidTokenError as e:
        raise InvalidTokenError(f"Invalid token: {str(e)}")
    if is_token_revoked(token):
        raise InvalidTokenError("Token revoked")
    return decoded


# ---- Revocation (logout) ------------------------------------------------------------------------------------------
# A logged-out token is remembered in Redis (by its SHA-256, never the token itself) until it would have expired, so
# a copied or stolen token stops working at logout instead of living on for ACCESS_TOKEN_EXPIRES_MIN.
_REVOKED_NS = "revoked_tokens"


def _token_id(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def revoke_token(token: str) -> None:
    try:
        claims = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGO], options={"verify_exp": False})
        ttl = int(claims.get("exp", 0) - time.time())
        if ttl <= 0:
            return
        from app.providers.cache.redis import get_redis_cache
        get_redis_cache().set(_token_id(token), True, ttl_seconds=ttl + 60, namespace=_REVOKED_NS)
    except Exception as e:  # never fail a logout
        logging.getLogger(__name__).warning(f"Token revocation not recorded: {e}")


_FLOOR_NS = "token_floor"


def invalidate_user_tokens(username: str) -> None:
    """Every token issued to this user before now stops working (password changed or reset, email changed, account removed)."""
    try:
        from app.providers.cache.redis import get_redis_cache
        get_redis_cache().set(username, int(time.time()), ttl_seconds=settings.ACCESS_TOKEN_EXPIRES_MIN * 60 + 120, namespace=_FLOOR_NS)
    except Exception as e:
        logging.getLogger(__name__).warning(f"Could not invalidate the tokens of a user: {e}")


def issued_before_floor(username: str, issued_at: int | float | None) -> bool:
    try:
        from app.providers.cache.redis import get_redis_cache
        floor = get_redis_cache().get(username, namespace=_FLOOR_NS)
        return floor is not None and (issued_at or 0) < int(floor)
    except Exception:
        return False


def is_token_revoked(token: str) -> bool:
    try:
        from app.providers.cache.redis import get_redis_cache
        return get_redis_cache().get(_token_id(token), namespace=_REVOKED_NS) is not None
    except Exception:
        return False  # Redis down: fail open (the signature and expiry were still verified)