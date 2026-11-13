"""Authenticator-app second factor (TOTP, RFC 6238): Microsoft Authenticator, Google Authenticator and any other app that scans a QR code.

How it works:
* the server makes a random secret for the account and shows it once as a QR code; the person scans it with the app;
* from then on the app shows a 6-digit code that changes every 30 seconds, and the server checks the code against the same secret;
* the secret is stored ENCRYPTED in the database (Fernet, key from settings), never in clear text and never sent again after the setup;
* a code works once: the time step it belongs to is recorded, so a code that was seen (shoulder surfing, a phishing page) cannot be replayed.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import re
import time
from typing import Optional

import pyotp
import qrcode
from cryptography.fernet import Fernet, InvalidToken
from qrcode.image.svg import SvgPathImage

from app.config.settings import settings

STEP_SECONDS = 30
DIGITS = 6
WINDOW = 1                      # one step either side of now is accepted, for clocks that are a little off


def _fernet() -> Fernet:
    material = settings.TOTP_ENCRYPTION_KEY or settings.SECRET_KEY
    key = base64.urlsafe_b64encode(hashlib.sha256(("alphacv-totp-secret:" + material).encode("utf-8")).digest())
    return Fernet(key)


def new_secret() -> str:
    """A random base32 secret (160 bits), the form every authenticator app expects."""
    return pyotp.random_base32()


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode("ascii")).decode("ascii")


def decrypt_secret(token: Optional[str]) -> Optional[str]:
    """The secret, or None when there is none or it cannot be read (the encryption key changed): the person is then set up again."""
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("ascii")
    except (InvalidToken, ValueError):
        return None


def provisioning_uri(secret: str, account: str) -> str:
    """The otpauth:// address an authenticator app reads from the QR code."""
    return pyotp.TOTP(secret, digits=DIGITS, interval=STEP_SECONDS).provisioning_uri(name=account, issuer_name=settings.TOTP_ISSUER)


def qr_data_url(uri: str) -> str:
    """The QR code as an SVG data URL, ready for an <img>. Made here so the secret never goes through a third-party QR service."""
    image = qrcode.make(uri, image_factory=SvgPathImage, box_size=10, border=2)
    buffer = io.BytesIO()
    image.save(buffer)
    return "data:image/svg+xml;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def grouped(secret: str) -> str:
    """The secret in groups of four, for typing it into the app by hand when the camera cannot scan."""
    return " ".join(secret[i:i + 4] for i in range(0, len(secret), 4))


def matching_step(secret: str, code: str, now: Optional[float] = None) -> Optional[int]:
    """The time step the 6-digit ``code`` belongs to (within the allowed window), or None when it is wrong. Spaces are ignored."""
    code = re.sub(r"\s+", "", code or "")
    if len(code) != DIGITS or not code.isdigit():
        return None
    totp = pyotp.TOTP(secret, digits=DIGITS, interval=STEP_SECONDS)
    current = int((time.time() if now is None else now) // STEP_SECONDS)
    found: Optional[int] = None
    for step in range(current - WINDOW, current + WINDOW + 1):       # every candidate is compared: the time taken does not show which one matched
        if hmac.compare_digest(totp.at(step * STEP_SECONDS), code):
            found = step
    return found
