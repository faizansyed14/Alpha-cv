"""Per-user second-factor auth mode helpers.

Modes:
- "real"    -> email OTP (a 6-digit code emailed to the user)
- "captcha" -> image CAPTCHA (no email needed).
"""
from __future__ import annotations


def normalize_otp_mode(value) -> str:
    """Return one of {"real", "captcha"}."""
    return "captcha" if str(value or "real").strip().lower() == "captcha" else "real"


def auth_mode_for_user(user) -> str:
    """Second-factor mode for a user: "otp" or "captcha", as stored on the account. This holds for the admin too: it starts on the
    CAPTCHA (set when the account is created, see app/db/database.py) and can be changed on the Users page. Either way no account,
    the admin included, signs in with a password alone."""
    return "captcha" if normalize_otp_mode(getattr(user, "otp_mode", "real")) == "captcha" else "otp"
