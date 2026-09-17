"""OTP Service for email-based authentication.

Generates, stores, and validates OTPs for user authentication.
"""

import hmac
import logging
import secrets
import os
import time

from app.core.config import settings
from typing import Optional, Tuple
from datetime import datetime, timedelta

from app.utils.redis_cache import get_redis_cache

logger = logging.getLogger(__name__)

_SENDS_NS = "otp_sends"


class OTPService:
    """Service for managing OTP generation and validation."""

    def __init__(self):
        self.redis_cache = get_redis_cache()
        self.otp_length = 6
        self.otp_ttl = settings.OTP_TTL_SECONDS
        # Allow a few retries without immediately invalidating a still-valid OTP.
        # Kept as an env var so you can tune security/UX per environment.
        self.max_attempts = settings.OTP_MAX_ATTEMPTS
        # Anti email-bomb: per-username sliding window on OTP sends + a cooldown
        # between requests (mirrors CaptchaService._check_and_record_send).
        self.max_sends = int(getattr(settings, "OTP_MAX_SENDS_PER_WINDOW", 5))
        self.send_window = int(getattr(settings, "OTP_SEND_WINDOW_SECONDS", 900))
        self.resend_cooldown = int(getattr(settings, "OTP_RESEND_COOLDOWN_SECONDS", 60))

    def check_and_record_send(self, username: str) -> Tuple[bool, Optional[int]]:
        """Sliding window: at most ``max_sends`` OTP emails per ``send_window``,
        with a ``resend_cooldown`` between them. Returns (allowed, retry_after_s).
        Fails open on cache errors so a Redis blip never blocks logins."""
        key = (username or "").strip().lower()
        try:
            now = time.time()
            data = self.redis_cache.get(key, namespace=_SENDS_NS) or {"ts": []}
            ts = [t for t in data.get("ts", []) if now - float(t) < self.send_window]
            if ts and (now - float(ts[-1])) < self.resend_cooldown:
                return False, int(self.resend_cooldown - (now - float(ts[-1]))) + 1
            if len(ts) >= self.max_sends:
                return False, max(1, int(self.send_window - (now - float(ts[0]))) + 1)
            ts.append(now)
            self.redis_cache.set(key, {"ts": ts}, ttl_seconds=self.send_window, namespace=_SENDS_NS)
            return True, None
        except Exception as e:  # never block on cache errors
            logger.debug(f"otp send-window check skipped: {e}")
            return True, None

    def generate_otp(self) -> str:
        """Generate a cryptographically-secure 6-digit OTP."""
        return f"{secrets.randbelow(1_000_000):06d}"
    
    def store_otp(self, email: str, otp: str, username: Optional[str] = None) -> bool:
        """
        Store OTP in Redis with TTL.
        
        Args:
            email: User's email address
            otp: Generated OTP
            username: Optional username for verification
            
        Returns:
            True if stored successfully
        """
        try:
            otp_key = f"otp:{email}"
            otp_data = {
                "otp": otp,
                "username": username,
                "created_at": datetime.utcnow().isoformat(),
                "attempts": 0
            }
            
            success = self.redis_cache.set(
                key=otp_key,
                value=otp_data,
                ttl_seconds=self.otp_ttl,
                namespace="auth"
            )
            
            if success:
                logger.info(f"✅ OTP stored for email: {email}")
            else:
                logger.error(f"❌ Failed to store OTP for email: {email}")
            
            return success
            
        except Exception as e:
            logger.error(f"❌ Error storing OTP: {e}")
            return False
    
    def verify_otp(self, email: str, otp: str) -> Tuple[bool, Optional[str]]:
        """
        Verify OTP for an email.
        
        Args:
            email: User's email address
            otp: OTP to verify
            
        Returns:
            Tuple of (is_valid, username) or (False, None)
        """
        try:
            otp_key = f"otp:{email}"
            otp_data = self.redis_cache.get(key=otp_key, namespace="auth")
            
            if not otp_data:
                logger.warning(f"⚠️ No OTP found for email: {email}")
                return False, None
            
            # Check attempts
            attempts = otp_data.get("attempts", 0)
            if attempts >= self.max_attempts:
                logger.warning(f"⚠️ Max attempts reached for email: {email}")
                # Delete OTP after max attempts
                self.redis_cache.delete(key=otp_key, namespace="auth")
                return False, None
            
            # Verify OTP using a constant-time comparison (avoids timing leaks)
            stored_otp = otp_data.get("otp") or ""
            if not hmac.compare_digest(str(stored_otp), str(otp)):
                # Increment attempts
                otp_data["attempts"] = attempts + 1
                self.redis_cache.set(
                    key=otp_key,
                    value=otp_data,
                    ttl_seconds=self.otp_ttl,
                    namespace="auth"
                )
                logger.warning(f"⚠️ Invalid OTP for email: {email} (attempt {attempts + 1}/{self.max_attempts})")
                return False, None
            
            # OTP is valid, get username and delete OTP
            username = otp_data.get("username")
            self.redis_cache.delete(key=otp_key, namespace="auth")
            logger.info(f"✅ OTP verified for email: {email}")
            return True, username
            
        except Exception as e:
            logger.error(f"❌ Error verifying OTP: {e}")
            return False, None
    
    def get_otp_info(self, email: str) -> Optional[dict]:
        """Get OTP information without verifying."""
        try:
            otp_key = f"otp:{email}"
            otp_data = self.redis_cache.get(key=otp_key, namespace="auth")
            return otp_data
        except Exception as e:
            logger.error(f"❌ Error getting OTP info: {e}")
            return None

# Singleton instance
_otp_service: Optional[OTPService] = None

def get_otp_service() -> OTPService:
    """Get singleton instance of OTP service."""
    global _otp_service
    if _otp_service is None:
        _otp_service = OTPService()
    return _otp_service
