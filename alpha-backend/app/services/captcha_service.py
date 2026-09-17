"""Image CAPTCHA service for login second-factor.

Replaces the old "fixed OTP" mode. For users whose auth mode is `captcha`, the
login flow shows a distorted image of a random code that the user must type.

Security features:
- Random code (ambiguous characters removed), case-insensitive.
- Challenge stored in Redis with an expiry (OTP-style TTL).
- Per-challenge attempt limit (deletes the challenge after too many wrong tries).
- Fingerprint binding: a challenge can only be solved by the same client that
  requested it (a client fingerprint hash is stored with the challenge).
- Sliding-window resend/refresh limit + cooldown per username (anti-abuse).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import logging
import random
import secrets
import time
import uuid
from datetime import datetime
from typing import Optional, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.core.config import settings
from app.utils.redis_cache import get_redis_cache

logger = logging.getLogger(__name__)

# Code alphabet with ambiguous characters (0/O, 1/I/L) removed.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_NS = "captcha"
_SENDS_NS = "captcha_sends"

_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _load_font(size: int):
    for path in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _fingerprint_hash(fingerprint: str) -> str:
    return hashlib.sha256((fingerprint or "").encode("utf-8")).hexdigest()


class CaptchaService:
    def __init__(self):
        self.cache = get_redis_cache()
        self.length = max(4, min(int(getattr(settings, "CAPTCHA_LENGTH", 6)), 8))
        self.ttl = int(getattr(settings, "CAPTCHA_TTL_SECONDS", 300))
        self.max_attempts = int(getattr(settings, "CAPTCHA_MAX_ATTEMPTS", 5))
        self.max_sends = int(getattr(settings, "CAPTCHA_MAX_SENDS_PER_WINDOW", 8))
        self.send_window = int(getattr(settings, "CAPTCHA_SEND_WINDOW_SECONDS", 600))
        self.resend_cooldown = int(getattr(settings, "CAPTCHA_RESEND_COOLDOWN_SECONDS", 2))

    # ----- sliding-window resend protection -----
    def _check_and_record_send(self, username: str) -> Tuple[bool, Optional[int]]:
        """Sliding window: allow at most max_sends within send_window; enforce cooldown.

        Returns (allowed, retry_after_seconds).
        """
        key = (username or "").strip().lower()
        try:
            now = time.time()
            data = self.cache.get(key, namespace=_SENDS_NS) or {"ts": []}
            ts = [t for t in data.get("ts", []) if now - float(t) < self.send_window]
            if ts and (now - float(ts[-1])) < self.resend_cooldown:
                return False, int(self.resend_cooldown - (now - float(ts[-1]))) + 1
            if len(ts) >= self.max_sends:
                retry = int(self.send_window - (now - float(ts[0]))) + 1
                return False, max(1, retry)
            ts.append(now)
            self.cache.set(key, {"ts": ts}, ttl_seconds=self.send_window, namespace=_SENDS_NS)
            return True, None
        except Exception as e:  # never block on cache errors
            logger.debug(f"captcha send-window check skipped: {e}")
            return True, None

    def generate_code(self) -> str:
        return "".join(secrets.choice(_ALPHABET) for _ in range(self.length))

    def create_challenge(self, username: str, fingerprint: str) -> dict:
        """Create a challenge and return {captcha_id, image (data URL), expires_in}.

        Raises ValueError("rate_limited", retry_after) when the resend window is exceeded.
        """
        allowed, retry_after = self._check_and_record_send(username)
        if not allowed:
            raise PermissionError(str(retry_after or self.send_window))

        code = self.generate_code()
        captcha_id = uuid.uuid4().hex
        challenge = {
            "code": code,
            "username": username,
            "fingerprint": _fingerprint_hash(fingerprint),
            "attempts": 0,
            "created_at": datetime.utcnow().isoformat(),
        }
        self.cache.set(f"chal:{captcha_id}", challenge, ttl_seconds=self.ttl, namespace=_NS)
        image_data_url = self._render_image(code)
        return {
            "captcha_id": captcha_id,
            "image": image_data_url,
            "expires_in": self.ttl,
        }

    def verify(self, captcha_id: str, answer: str, username: str, fingerprint: str) -> bool:
        try:
            key = f"chal:{captcha_id}"
            challenge = self.cache.get(key, namespace=_NS)
            if not challenge:
                return False
            # Fingerprint binding
            if not hmac.compare_digest(
                str(challenge.get("fingerprint") or ""), _fingerprint_hash(fingerprint)
            ):
                logger.warning("⚠️ CAPTCHA fingerprint mismatch")
                return False
            if str(challenge.get("username") or "") != str(username or ""):
                return False
            attempts = int(challenge.get("attempts", 0))
            if attempts >= self.max_attempts:
                self.cache.delete(key, namespace=_NS)
                return False
            # Case-insensitive constant-time compare
            stored = str(challenge.get("code") or "").upper()
            given = str(answer or "").strip().upper()
            if not hmac.compare_digest(stored, given):
                challenge["attempts"] = attempts + 1
                self.cache.set(key, challenge, ttl_seconds=self.ttl, namespace=_NS)
                return False
            # Success: one-time use
            self.cache.delete(key, namespace=_NS)
            return True
        except Exception as e:
            logger.error(f"❌ CAPTCHA verify error: {e}")
            return False

    def peek_code(self, captcha_id: str) -> Optional[str]:
        """DEV ONLY: read the code for automated tests."""
        try:
            challenge = self.cache.get(f"chal:{captcha_id}", namespace=_NS)
            return challenge.get("code") if challenge else None
        except Exception:
            return None

    # ----- image rendering -----
    def _render_image(self, code: str) -> str:
        width, height = 220, 80
        bg = (245, 247, 250)
        img = Image.new("RGB", (width, height), bg)
        draw = ImageDraw.Draw(img)

        # Background noise: random faint lines + dots
        for _ in range(7):
            draw.line(
                [(random.randint(0, width), random.randint(0, height)),
                 (random.randint(0, width), random.randint(0, height))],
                fill=(random.randint(180, 220), random.randint(180, 220), random.randint(180, 220)),
                width=1,
            )
        for _ in range(220):
            draw.point(
                (random.randint(0, width), random.randint(0, height)),
                fill=(random.randint(150, 210), random.randint(150, 210), random.randint(150, 210)),
            )

        # Draw each character with random position, rotation and brand-ish color
        font = _load_font(40)
        n = len(code)
        slot = width // (n + 1)
        for i, ch in enumerate(code):
            ch_img = Image.new("RGBA", (slot + 12, height), (0, 0, 0, 0))
            ch_draw = ImageDraw.Draw(ch_img)
            color = (random.randint(20, 90), random.randint(40, 110), random.randint(120, 200))
            ch_draw.text((6, random.randint(6, 22)), ch, font=font, fill=color)
            angle = random.uniform(-28, 28)
            ch_img = ch_img.rotate(angle, expand=1, resample=Image.BICUBIC)
            img.paste(ch_img, (slot * i + 8, 0), ch_img)

        # Subtle wave distortion
        img = img.filter(ImageFilter.SMOOTH)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/png;base64,{b64}"


_captcha_service: Optional[CaptchaService] = None


def get_captcha_service() -> CaptchaService:
    global _captcha_service
    if _captcha_service is None:
        _captcha_service = CaptchaService()
    return _captcha_service
