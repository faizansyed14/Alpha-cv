"""The text the CV search box and the boolean search match against (stored in the ``candidate_search`` table).

  text         every word of the CV (its text, title, skills, keywords, certifications, name, contact, location ...) as
               lower-case tokens joined by single spaces. A keyword is found as a whole word, and a phrase as an exact phrase.
  literal      only what the CV literally says (its text, name, contact, location, nationality): no AI-written skill or
               responsibility sentences or keywords. Boolean search is decided on this, so a term the CV does not contain
               never matches.
  location     location tokens ("Dubai, UAE" -> "dubai uae")
  nationality  nationality tokens

The query side normalises what the recruiter types with the same `normalize`, so both sides always agree. These are pure
functions; the store (app/store/talent.py) writes the rows and runs the queries.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional

# Technology names a word tokenizer would otherwise destroy ("C#" -> "c", ".NET" -> "net").
_TECH = (
    (re.compile(r"(?<![a-z0-9])c\s*\+\+"), " cplusplus "),
    (re.compile(r"(?<![a-z0-9])c\s*#"), " csharp "),
    (re.compile(r"(?<![a-z0-9])f\s*#"), " fsharp "),
    (re.compile(r"\.net\b"), " dotnet "),
)
_TOKEN = re.compile(r"[^\W_]+", re.UNICODE)
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def tokens(text: Any) -> List[str]:
    s = unicodedata.normalize("NFKC", str(text or "")).lower()
    for rx, replacement in _TECH:
        s = rx.sub(replacement, s)
    return _TOKEN.findall(s)


def normalize(text: Any) -> str:
    return " ".join(tokens(text))


def experience_years(value: Any) -> Optional[float]:
    """5 / 5.5 / "5" / "5+ years" -> a number; anything unreadable or implausible -> None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        years = float(value)
    else:
        m = _NUMBER.search(str(value))
        if not m:
            return None
        years = float(m.group())
    return years if 0 <= years <= 70 else None


def _strings(values: Any) -> Iterable[str]:
    if isinstance(values, (list, tuple)):
        return [str(v) for v in values if v]
    return [str(values)] if values else []


def build_search_documents(person: Dict[str, Any], text: str) -> Dict[str, str]:
    """The search strings for one candidate (text = literal + extra; location and nationality on their own). ``person`` holds the candidate's facts (full_name, job_title, category, email, phone,
    location, nationality, notice_period) and lists (keywords, skills, responsibilities, languages, certifications)."""
    phone = str(person.get("phone") or "")
    digits = re.sub(r"\D", "", phone)   # so a number typed without spaces or "+" still matches
    parts: List[str] = [text or ""]
    for key in ("full_name", "job_title", "category", "email", "phone", "location", "nationality", "notice_period"):
        parts.extend(_strings(person.get(key)))
    parts.append(digits)
    for key in ("keywords", "skills", "responsibilities", "languages", "certifications"):
        parts.extend(_strings(person.get(key)))

    literal = [text or ""]
    for key in ("full_name", "email", "phone", "location", "nationality", "notice_period"):
        literal.extend(_strings(person.get(key)))
    literal.append(digits)

    extra: List[str] = []         # what the AI added to the CV's own words: text = literal + extra
    for key in ("job_title", "category", "keywords", "skills", "responsibilities", "languages", "certifications"):
        extra.extend(_strings(person.get(key)))

    return {
        "text": normalize(" \n ".join(parts)),
        "literal": normalize(" \n ".join(literal)),
        "extra": normalize(" \n ".join(extra)),
        "location": normalize(person.get("location")),
        "nationality": normalize(person.get("nationality")),
    }


def matched_terms(search_text: str, terms: List[str]) -> List[str]:
    """Which normalised terms appear in the text as whole words (a multi-word term as an exact phrase)."""
    padded = f" {search_text or ''} "
    return [t for t in terms if f" {t} " in padded]
