"""Per-user second-factor auth mode helpers.

Modes:
- "real"    -> email OTP (a 6-digit code emailed to the user)
- "captcha" -> image CAPTCHA (no email needed)
- "totp"    -> a 6-digit code from an authenticator app (Microsoft Authenticator ...).
"""
from __future__ import annotations


def normalize_otp_mode(value) -> str:
    """Return one of {"real", "captcha", "totp"}; anything else is the email code."""
    mode = str(value or "real").strip().lower()
    return mode if mode in ("captcha", "totp") else "real"


def auth_mode_for_user(user) -> str:
    """Second-factor mode for a user: "otp" (email code), "captcha" or "totp" (authenticator app), as stored on the account. This holds for
    the admin too: it starts on the CAPTCHA (set when the account is created, see app/db/database.py) and can be changed on the Users page.
    Either way no account, the admin included, signs in with a password alone."""
    mode = normalize_otp_mode(getattr(user, "otp_mode", "real"))
    return "otp" if mode == "real" else mode
