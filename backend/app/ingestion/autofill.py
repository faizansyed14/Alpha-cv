"""Autofill for the public application form: read a dropped CV with the app's own parsers and offer only what is certain.

Nothing new is invented here. The text comes from the same parsers as every CV (`ParsingService.process_document`),
e-mail / phone / name come from the same contact extraction (`contact.py`), and years of experience comes from the same
`standardize_cv` prompt the application pipeline runs. That LLM answer is parked in Redis for a short time under the
hash of the CV text, so when the applicant submits the form the pipeline finds it there and does not call the model a
second time.

A field is only offered when it is certain:
  - e-mail, phone      the candidate's own ones, as ranked by the contact parser
  - name               a real person name (LLM name, else the document header, else the e-mail)
  - years              the LLM's number, when it gave one
  - nationality, notice period, location: only when the CV labels them ("Nationality: Indian", "Notice period: 30 days",
                       "Current location: Dubai, UAE") and the value maps cleanly onto what the form accepts
Everything else is left out so the applicant types it.
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

CACHE_NAMESPACE = "cv_autofill"
CACHE_TTL_SECONDS = 30 * 60          # long enough to fill in and submit the form, then it is gone

NOTICE_OPTIONS = ("Immediately", "15 days", "30 days", "60 days", "More than 60 days")   # same as the form

_LABEL_END = r"(?=\s{2,}|\s*[|•·;\n]|\s+(?:[A-Z][A-Za-z ]{2,24}\s*[:\-–]\s)|$)"


def text_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


# ------------------------------------------------------------------------------------------------- the shared cache
def cached_standardized(text: str) -> Optional[Dict[str, Any]]:
    try:
        from app.providers.cache.redis import get_redis_cache

        value = get_redis_cache().get(text_hash(text), namespace=CACHE_NAMESPACE)
        return value if isinstance(value, dict) and value else None
    except Exception:  # noqa: BLE001 - a cache miss is always acceptable
        return None


def park_standardized(text: str, standardized: Dict[str, Any]) -> None:
    try:
        from app.providers.cache.redis import get_redis_cache

        get_redis_cache().set(text_hash(text), standardized, ttl_seconds=CACHE_TTL_SECONDS, namespace=CACHE_NAMESPACE)
    except Exception:  # noqa: BLE001
        pass


def phone_is_certain(raw_text: str, phone: str) -> bool:
    """A phone is only offered when the CV itself marks it as a phone: it carries a country code (+ or 00) or follows a
    label such as "Mobile:" / "Tel". A bare run of digits is not enough, and anything shaped like a date never is."""
    from app.ingestion.contact import _DATE_RANGE_ANYWHERE, _PHONE_LABEL

    value = (phone or "").strip()
    digits = re.sub(r"\D", "", value)
    if not (7 <= len(digits) <= 15) or "/" in value or _DATE_RANGE_ANYWHERE.search(value):
        return False
    if value.startswith("+") or value.startswith("00"):
        return True
    at = (raw_text or "").find(value)
    return at >= 0 and bool(_PHONE_LABEL.search(raw_text[max(0, at - 20): at]))


# ------------------------------------------------------------------------------------------ labelled facts in the CV
def _labelled(raw_text: str, labels: str) -> Optional[str]:
    """The text after "<label>:" on its line, or None. Only an explicit label counts."""
    m = re.search(rf"(?im)^\W*(?:{labels})\s*[:\-–]\s*(.+?)\s*$", raw_text or "")
    if not m:
        return None
    value = re.split(r"\s{3,}|\s\|\s|[•·]", m.group(1).strip())[0].strip(" ,;.")
    return value or None


def notice_period_option(raw_text: str) -> Optional[str]:
    """Map "Notice period: 1 month" onto one of the form's options, or None when it is not clear."""
    value = _labelled(raw_text, r"notice\s*period|notice")
    if not value:
        return None
    v = value.lower()
    if re.fullmatch(r"(immediate(ly)?|nil|none|no notice|0 ?(days?)?|available immediately|asap)", v):
        return "Immediately"
    m = re.fullmatch(r"(?:about |approx\.? |around )?(\d{1,3})\s*(day|days|week|weeks|month|months)", v)
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)
    days = n if unit.startswith("day") else n * 7 if unit.startswith("week") else n * 30
    if days <= 0:
        return "Immediately"
    if days == 15 or (unit.startswith("week") and n == 2):
        return "15 days"
    if days == 30:
        return "30 days"
    if days == 60:
        return "60 days"
    if days > 60:
        return "More than 60 days"
    return None


def nationality_raw(raw_text: str) -> Optional[str]:
    """What the CV says after "Nationality:" (the form maps it onto its country list, or leaves it blank)."""
    value = _labelled(raw_text, r"nationality|citizenship")
    return value if value and len(value) <= 40 and re.fullmatch(r"[A-Za-z][A-Za-z .'\-]*", value) else None


def location_label(raw_text: str) -> Optional[str]:
    """A "City, Country" the form's city list knows, from a labelled location, or None. The city must match EXACTLY."""
    from app.services import locations_service

    value = _labelled(raw_text, r"current\s+location|location|current\s+city|city|based\s+in|residing\s+in")
    if not value:
        return None
    parts = [p.strip() for p in value.split(",") if p.strip()]
    if not parts:
        return None
    city = parts[0]
    hits = [h for h in locations_service.search_locations(city, limit=30) if h["city"].lower() == city.lower()]
    if len(parts) > 1:   # "Dubai, UAE": the country part must agree, otherwise it is not certain
        tail = parts[-1].lower()
        hits = [h for h in hits if tail in h["country"].lower() or h["country"].lower() in tail
                or (tail in ("uae", "u.a.e", "u.a.e.") and "emirates" in h["country"].lower())]
    return hits[0]["label"] if len(hits) == 1 else (hits[0]["label"] if hits and _is_dominant(hits) else None)


def _is_dominant(hits) -> bool:
    return len({h["country"] for h in hits}) == 1


# ------------------------------------------------------------------------------------------------------ the autofill
def build_autofill(parsed: Dict[str, Any], standardized: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """{"fields": {...only certain values...}, "unread": [names of form fields the CV did not settle]}."""
    from app.ingestion.contact import looks_like_a_name, resolve_name

    raw = parsed.get("raw_text") or ""
    pii = parsed.get("extracted_pii") or {}
    emails, phones = pii.get("email") or [], pii.get("phone") or []
    email = emails[0] if emails else None
    standardized = standardized or {}

    fields: Dict[str, Any] = {}
    sources: Dict[str, str] = {}

    if email and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        fields["email"], sources["email"] = email, "CV contact details"
    phone = next((p for p in phones if phone_is_certain(raw, p)), None)
    if phone:
        fields["phone"], sources["phone"] = phone.strip(), "CV contact details"

    name = resolve_name(standardized.get("name") or (standardized.get("contact_info") or {}).get("name"), raw, email)
    if name and looks_like_a_name(name) and re.fullmatch(r"[A-Za-z\s\-'.]+", name):
        fields["name"], sources["name"] = name, "CV"

    years = standardized.get("years_of_experience")
    if isinstance(years, (int, float)) and not isinstance(years, bool) and 0 <= years <= 60:
        fields["yearsOfExperience"] = str(int(years)) if float(years).is_integer() else f"{float(years):.1f}"
        sources["yearsOfExperience"] = "AI reading of the CV"

    notice = notice_period_option(raw)
    if notice:
        fields["noticePeriod"], sources["noticePeriod"] = notice, "Notice period stated in the CV"
    nat = nationality_raw(raw)
    if nat:
        fields["nationality"], sources["nationality"] = nat, "Nationality stated in the CV"
    loc = location_label(raw)
    if loc:
        fields["location"], sources["location"] = loc, "Location stated in the CV"

    return {"fields": fields, "sources": sources}
