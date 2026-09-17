"""Per-user second-factor auth mode helpers.

Modes:
- "real"    -> email OTP (a 6-digit code emailed to the user)
- "captcha" -> image CAPTCHA (the old "fixed" mode is removed; any legacy
               "fixed" value is treated as captcha so those users keep working
               without needing an email).
"""
from __future__ import annotations


def normalize_otp_mode(value) -> str:
    """Return one of {"real", "captcha"}. Legacy "fixed" maps to "captcha"."""
    m = (str(value or "real")).strip().lower()
    if m in ("captcha", "fixed"):
        return "captcha"
    return "real"


def auth_mode_for_user(user) -> str:
    """Second-factor mode for a user: "otp" or "captcha"."""
    return "captcha" if normalize_otp_mode(getattr(user, "otp_mode", "real")) == "captcha" else "otp"
