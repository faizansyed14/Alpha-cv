"""Password rules for accounts created or changed through the API.

Length is what matters (NIST 800-63B): at least MIN_LENGTH characters, no composition tricks, but never a password that
is on the short list below. A password may contain the person's own name or email. The check runs on the server; the form only
repeats the same text.
"""
from __future__ import annotations

MIN_LENGTH = 10
MAX_LENGTH = 128     # hashing very long inputs is a cheap way to burn CPU

# The most common passwords that still satisfy a length rule. (A full breached-password list is better; this is the floor.)
_COMMON = {
    "password", "password1", "password12", "password123", "password1234", "passw0rd123", "p@ssw0rd123", "p@ssword123",
    "qwerty123", "qwertyuiop", "qwerty12345", "1234567890", "12345678910", "123456789012", "1q2w3e4r5t", "1qaz2wsx3edc",
    "iloveyou123", "welcome123", "welcome1234", "admin12345", "administrator", "letmein123", "changeme123", "abc1234567",
    "abcdefghij", "0123456789", "9876543210", "alphacv123", "alphacv1234", "monkey1234", "dragon1234", "football123",
}


def password_problem(password: str, *, username: str = "", email: str = "") -> str | None:
    """Why the password is not acceptable, or None when it is. (``username`` and ``email`` are accepted for the callers that pass them
    but no longer matter: a password may contain them.)"""
    if not isinstance(password, str) or len(password) < MIN_LENGTH:
        return f"Password must be at least {MIN_LENGTH} characters"
    if len(password) > MAX_LENGTH:
        return f"Password must be at most {MAX_LENGTH} characters"
    low = password.lower()
    if low in _COMMON or len(set(low)) <= 3:
        return "That password is too common or too repetitive"
    if low.isdigit():
        return "Password cannot be only digits"
    return None
