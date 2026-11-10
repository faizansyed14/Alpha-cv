"""Safe logging helpers: no personal data or secrets in log lines, and one place for security events."""
from __future__ import annotations

import logging

_security = logging.getLogger("alphacv.security")


def mask_email(value: str | None) -> str:
    """'jane.doe@corp.com' -> 'j***@corp.com' (enough to tell accounts apart in an incident, not enough to harvest)."""
    v = (value or "").strip()
    if "@" not in v:
        return "***" if v else "-"
    local, _, domain = v.partition("@")
    return f"{local[:1]}***@{domain}"


def _clean(v: object) -> str:
    # one line per event: no newlines or spaces that could forge a second log line
    return str(v).replace("\r", " ").replace("\n", " ").replace('"', "'")[:200]


def security_event(event: str, level: int = logging.INFO, **fields: object) -> None:
    """One structured line on the 'alphacv.security' logger, e.g.
    ``security event=login_failed reason=bad_password account=j***@corp.com ip=10.0.0.4``.
    Never pass passwords, tokens, OTP / CAPTCHA codes or full emails."""
    parts = " ".join(f'{k}="{_clean(v)}"' for k, v in fields.items() if v is not None)
    _security.log(level, "security event=%s %s", event, parts)
