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
    """Second-factor mode for a user: "otp" or "captcha". Admins always use the CAPTCHA (no email needed, and the
    most privileged account must not log in with a password alone)."""
    if getattr(user, "role", None) == "admin":
        return "captcha"
    return "captcha" if normalize_otp_mode(getattr(user, "otp_mode", "real")) == "captcha" else "otp"
