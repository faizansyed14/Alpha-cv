"""Who a CV belongs to: the keys that say two CVs are the same person.

A newer CV of a person who is already in the database replaces their CV instead of becoming a second candidate. "The same person" is
deliberately strict: the e-mail address AND the phone number must both match. An e-mail alone (shared agency or family addresses, a
typo) or a phone alone is never enough, because a wrong match would overwrite someone else's CV.
"""
import re
from typing import Iterable, List, Optional

PHONE_KEY_DIGITS = 9          # the subscriber part of the number: +971 50 123 4567, 00971501234567 and 0501234567 all end in 501234567


def email_key(email: Optional[str]) -> Optional[str]:
    """The address as it is compared: trimmed and lower-case; None when it is not an address."""
    if not isinstance(email, str):
        return None
    value = email.strip().lower()
    return value if "@" in value and "." in value.split("@")[-1] else None


def phone_key(phone: Optional[str]) -> Optional[str]:
    """The last nine digits of a phone number, so the same number written with or without the country code or a leading 0 compares
    equal. None for a number too short to be one."""
    if not isinstance(phone, str):
        return None
    digits = re.sub(r"\D", "", phone)
    return digits[-PHONE_KEY_DIGITS:] if len(digits) >= PHONE_KEY_DIGITS else None


def email_keys(values: Iterable[Optional[str]]) -> List[str]:
    return sorted({k for k in (email_key(v) for v in values) if k})


def phone_keys(values: Iterable[Optional[str]]) -> List[str]:
    return sorted({k for k in (phone_key(v) for v in values) if k})
