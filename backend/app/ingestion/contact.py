"""Reading the candidate's own e-mail, phone and name out of CV text.

A CV can hold several e-mails and numbers: the candidate's, referees', an Emirates ID, a passport number, date ranges.
Everything found is still redacted before the text goes to the LLM, but the value stored on the record must be the
candidate's. So matches are ranked: those near the top of the document and not in a "references" section come first.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

import phonenumbers

# GCC / Levant / Egypt, South and South-East Asia, plus global anchors. Region hints only tell libphonenumber how to read
# a number that carries no country code; numbers with '+' or '00' parse correctly under any hint.
PHONE_REGION_HINTS = [
    "AE", "SA", "QA", "KW", "BH", "OM", "JO", "LB", "EG",
    "IN", "PK", "BD", "PH", "NP", "LK",
    "GB", "US",
]

# Any run of 9+ digits (grouped by spaces, dashes, dots or brackets) that libphonenumber did not accept. It is redacted
# from the text sent to the LLM but never stored as the candidate's phone.
PHONE_FALLBACK = re.compile(r"(?:\+?\d[\d\-.\s()]{7,}\d)")

# local part @ domain . tld, tolerating a line break or spaces around the '@' that PDF extraction sometimes leaves
EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+[ \t]*\n?[ \t]*@[ \t]*\n?[ \t]*[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")

_REFERENCE_HEADING = re.compile(r"\b(references?|referees?)\b", re.I)
_ID_LABEL = re.compile(r"(emirates\s*id|\bE\.?I\.?D\b|passport|visa|labou?r\s*card|iqama|national\s*id|\bid\s*(?:no|number)|"
                       r"p\.?o\.?\s*box|licen[cs]e|uid|file\s*no|iban|account)\W{0,12}$", re.I)
_YEAR = r"(?:19|20)\d{2}"
_DATE_LIKE = re.compile(rf"^\s*(?:\d{{1,2}}[\-./]\d{{1,2}}[\-./]\d{{2,4}}|{_YEAR}\s*[\-–—/]\s*(?:{_YEAR}|\d{{2}})|"
                        rf"\d{{1,2}}[\-./]{_YEAR}\s*[\-–—]\s*\d{{1,2}}[\-./]{_YEAR})\s*$")
_EMIRATES_ID = re.compile(r"^784[\s\-]?\d{4}[\s\-]?\d{7}[\s\-]?\d$")

_EMAIL_NOISE = re.compile(r"^(noreply|no-reply|donotreply|do-not-reply)@", re.I)


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def _in_reference_section(text: str, pos: int) -> bool:
    """True when the nearest heading-like 'references' line above ``pos`` is close and no later section has begun."""
    window_start = max(0, pos - 400)
    window = text[window_start:pos]
    last = None
    for m in _REFERENCE_HEADING.finditer(window):
        line_start = window.rfind("\n", 0, m.start()) + 1
        line_end = window.find("\n", m.end())
        line = window[line_start: line_end if line_end != -1 else len(window)]
        if len(line.strip()) <= 40:                        # a heading, not "references available on request"
            last = m
    return last is not None


def _rank(text: str, spans: List[Tuple[int, int, str]], keep_order: bool = False) -> List[str]:
    """Values ordered best first: outside reference sections, then by position in the document. No duplicates."""
    keyed = spans if keep_order else sorted(spans, key=lambda s: (_in_reference_section(text, s[0]), s[0]))
    out: List[str] = []
    seen = set()
    for _, _, value in keyed:
        k = value.lower() if "@" in value else _digits(value)
        if k and k not in seen:
            seen.add(k)
            out.append(value)
    return out


def find_emails(text: str) -> List[Tuple[int, int, str]]:
    """(start, end, address) for every address in ``text``; addresses split by whitespace are joined."""
    found = []
    for m in EMAIL.finditer(text):
        address = re.sub(r"\s+", "", m.group()).rstrip(".")
        if "@" in address:
            found.append((m.start(), m.end(), address))
    return found


def _is_not_a_phone(raw: str, text: str, start: int) -> bool:
    if _DATE_LIKE.match(raw) or _EMIRATES_ID.match(raw.strip()):
        return True
    before = text[max(0, start - 30): start]
    return bool(_ID_LABEL.search(before))


_PHONE_LABEL = re.compile(r"(mobile|mob|cell|phone|ph|tel|telephone|contact|whatsapp|call|m|t)\W{0,6}(?:no\.?|number|#)?\W{0,6}$", re.I)
_HEADER_CHARS = 800


def _phone_score(text: str, start: int, raw: str, number) -> int:
    """How likely a valid number is the candidate's own: explicit country code, a label, the CV header, a phone line type."""
    score = 0
    stripped = raw.strip()
    if stripped.startswith("+") or stripped.startswith("00"):
        score += 3
    if _PHONE_LABEL.search(text[max(0, start - 20): start]):
        score += 4
    if start < _HEADER_CHARS:
        score += 2
    try:
        kind = phonenumbers.number_type(number)
    except Exception:  # noqa: BLE001
        kind = None
    if kind in (phonenumbers.PhoneNumberType.MOBILE, phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE):
        score += 2
    elif kind == phonenumbers.PhoneNumberType.FIXED_LINE:
        score += 1
    elif kind is not None:
        score -= 3                                          # premium rate, shared cost, pager, ...: not a person's line
    return score


def find_phones(text: str) -> Tuple[List[Tuple[int, int, str]], List[Tuple[int, int]]]:
    """(candidate phones best first, every span to redact).

    A candidate is a number libphonenumber accepts as valid for some region, that is not an ID, passport number or date
    range, and that is backed by evidence: a country code, a "Mobile:"-style label or the CV header. Only when no
    number has any evidence is the best bare valid number used. Unlabelled digit runs that libphonenumber rejects
    are redacted from the text but never stored as the candidate's phone, so a wrong number is not saved."""
    redact: List[Tuple[int, int]] = []
    scored: List[Tuple[int, int, int, str]] = []          # (start, end, score, raw)

    for region in [None] + PHONE_REGION_HINTS:
        try:
            for match in phonenumbers.PhoneNumberMatcher(text, region):
                if not phonenumbers.is_valid_number(match.number):
                    continue
                redact.append((match.start, match.end))
                if any(match.start < e and s < match.end for s, e, _, _ in scored):
                    continue
                if _is_not_a_phone(match.raw_string, text, match.start):
                    continue
                scored.append((match.start, match.end, _phone_score(text, match.start, match.raw_string, match.number),
                               match.raw_string.strip()))
        except Exception:  # noqa: BLE001 - a matcher failure must never break parsing
            continue

    for m in PHONE_FALLBACK.finditer(text):
        if len(_digits(m.group())) < 9:
            continue
        if any(m.start() < e and s < m.end() for s, e in redact):
            continue
        redact.append((m.start(), m.end()))

    evidenced = [x for x in scored if x[2] >= 3 and x[2] >= 0]
    chosen = evidenced or [x for x in scored if x[2] >= 0]
    chosen.sort(key=lambda x: (_in_reference_section(text, x[0]), -x[2], x[0]))
    return [(s, e, raw) for s, e, _, raw in chosen], redact


def extract_contacts(text: str) -> Dict[str, object]:
    """{"emails": [...], "phones": [...], "redact": [(start, end), ...], "email_spans": [...]}; lists best first."""
    emails = find_emails(text)
    phones, redact = find_phones(text)
    return {
        "emails": _rank(text, [e for e in emails if not _EMAIL_NOISE.match(e[2])] or emails),
        "phones": _rank(text, phones, keep_order=True),
        "redact": redact,
        "email_spans": [(s, e) for s, e, _ in emails],
    }


# ---------------------------------------------------------------------------------------------------------------------
# the candidate's name
# ---------------------------------------------------------------------------------------------------------------------
_NOT_A_NAME = {"unknown", "not specified", "n/a", "na", "none", "null", "candidate", "applicant", "name", "your name",
               "full name", "john doe", "jane doe"}
_HEADER_WORDS = re.compile(
    r"\b(resume|curriculum|vitae|cv|profile|summary|objective|contact|address|email|e-mail|phone|mobile|tel|experience|"
    r"education|skills|declaration|personal|details|page|career|work|employment|references?|nationality|date|birth|"
    r"manager|engineer|developer|analyst|consultant|officer|executive|specialist|director|designer|accountant|"
    r"administrator|coordinator|supervisor|assistant|intern|lead|senior|junior|dubai|abu|dhabi|sharjah|ajman|riyadh|"
    r"doha|kuwait|muscat|manama|cairo|mumbai|delhi|bangalore|chennai|hyderabad|karachi|lahore|london|uae|india)\b", re.I)
_NAME_WORD = re.compile(r"^[A-Za-z][A-Za-z'.\-]*$")


def looks_like_a_name(value: Optional[str]) -> bool:
    """A usable person name: 2-5 alphabetic words, no placeholder, digit, e-mail or heading word."""
    if not isinstance(value, str):
        return False
    v = " ".join(value.split())
    if not v or v.lower() in _NOT_A_NAME or "[" in v or "@" in v or any(c.isdigit() for c in v):
        return False
    words = v.split(" ")
    if not 2 <= len(words) <= 5 or not all(_NAME_WORD.match(w) for w in words):
        return False
    return not _HEADER_WORDS.search(v)


def name_from_header(raw_text: str, lines: int = 12) -> Optional[str]:
    """The first of the document's opening lines that reads as a person's name (CVs lead with it)."""
    seen = 0
    for line in raw_text.splitlines():
        line = line.strip(" \t|-_*#")
        if not line:
            continue
        seen += 1
        if seen > lines:
            break
        for candidate in (line, *[p.strip() for p in re.split(r"[|,•·]", line)]):
            if looks_like_a_name(candidate):
                return " ".join(w if w.isupper() is False else w.title() for w in candidate.split())
    return None


def name_from_email(address: Optional[str]) -> Optional[str]:
    if not address or "@" not in address:
        return None
    local = re.sub(r"\d+", " ", address.split("@", 1)[0])
    parts = [p for p in re.split(r"[._\-+\s]+", local) if len(p) > 1]
    if len(parts) < 2 or not all(p.isalpha() for p in parts):
        return None
    return " ".join(p.capitalize() for p in parts[:3])


def resolve_name(llm_name: Optional[str], raw_text: str, email: Optional[str]) -> Optional[str]:
    """The LLM's name when it is a real one; otherwise the document header, then the e-mail's local part."""
    if looks_like_a_name(llm_name):
        return " ".join(llm_name.split())
    return name_from_header(raw_text or "") or name_from_email(email) or (
        " ".join(llm_name.split()) if isinstance(llm_name, str) and llm_name.strip() and "[" not in llm_name
        and llm_name.strip().lower() not in _NOT_A_NAME else None)
