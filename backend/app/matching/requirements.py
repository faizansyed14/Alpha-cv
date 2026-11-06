"""Mandatory languages and certifications of a job, checked against a CV before the LLM step.

Why it is a small adjustment and not a weight or a filter (measured on synthetic CV/JD sets, see the matching notes):
  * A CV that does not list a language or certificate is not a CV that lacks it (extraction is incomplete), so absence alone
    must never cost points. Only a CV that lists OTHER languages / certificates but not the required one is "missing".
  * Hard filters threw away most of the right candidates once extraction recall dropped below 100%.
  * Embeddings cannot tell certificates apart (CPA vs CMA, Developer vs Solutions Architect score 0.9+), so certificates are
    matched symbolically: acronyms and key words, never similarity.

Each requirement ends up ``met`` | ``missing`` | ``unknown``:
  met      the CV lists it                                       -> certificates only: + REQUIREMENT_MET_BONUS points (capped)
  missing  the CV lists other items of that kind, not this one   -> x REQUIREMENT_MISSING_FACTOR
  unknown  the CV lists nothing of that kind                     -> no change
Only requirements the JD marks mandatory can cost points; preferred ones can only add a small bonus.
A language match earns no bonus: nearly every CV lists Arabic and English, so it says nothing about who is better, and on real
CVs a language bonus lifted unrelated candidates. A certificate is rare, so it does separate candidates.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

from app.config.settings import settings

MAX_MISSING_PENALTIES = 3     # a CV is never multiplied down more than this many times
MAX_MET_BONUSES = 2           # nor lifted more than this many times

# ---------------------------------------------------------------------------------------------------------------------
# Languages: a closed vocabulary, matched by name
# ---------------------------------------------------------------------------------------------------------------------
_LANG_NOISE = {"native", "fluent", "fluently", "proficient", "proficiency", "professional", "working", "basic", "intermediate",
               "advanced", "beginner", "mother", "tongue", "bilingual", "conversational", "business", "good", "excellent",
               "read", "write", "written", "spoken", "speak", "speaking", "language", "level", "skills", "full", "limited",
               "elementary", "mothertongue", "first", "second", "native-level", "in", "of", "the", "with", "a"}
_LANG_ALIASES = {"arabic": "arabic", "العربية": "arabic", "عربي": "arabic", "english": "english", "الإنجليزية": "english",
                 "انجليزي": "english", "french": "french", "français": "french", "francais": "french", "hindi": "hindi",
                 "urdu": "urdu", "tagalog": "tagalog", "filipino": "tagalog", "spanish": "spanish", "español": "spanish",
                 "german": "german", "deutsch": "german", "russian": "russian", "chinese": "chinese", "mandarin": "chinese",
                 "turkish": "turkish", "persian": "persian", "farsi": "persian", "bengali": "bengali", "bangla": "bengali",
                 "malayalam": "malayalam", "tamil": "tamil", "telugu": "telugu", "punjabi": "punjabi", "pashto": "pashto"}


def normalize_language(value: Any) -> str:
    """'Arabic (Native)' -> 'arabic', 'English - fluent' -> 'english', '' when nothing usable is left."""
    text = re.sub(r"\([^)]*\)", " ", str(value or "").lower())
    words = [w for w in re.split(r"[^\w؀-ۿ]+", text) if w and w not in _LANG_NOISE]
    if not words:
        return ""
    name = " ".join(words)
    return _LANG_ALIASES.get(name, _LANG_ALIASES.get(words[0], name))


# ---------------------------------------------------------------------------------------------------------------------
# Certifications: matched by acronym and key words (symbolic, see module docstring)
# ---------------------------------------------------------------------------------------------------------------------
_STOP = {"of", "the", "and", "for", "in", "a", "an", "by", "from", "on", "with"}
_GENERIC = {"certification", "certificate", "certified", "license", "licence", "licensed", "qualified", "qualification",
            "member", "affiliate", "membership", "exam", "course", "holder", "professional", "diploma", "institute"}
_KEEP_IN_INITIALS = {"certified", "professional", "institute"}


def _tokens(s: str) -> List[str]:
    s = re.sub(r"[^a-z0-9()+ ]", " ", s.lower().replace("-", " "))
    return [t for t in s.split() if t]


def _parts(s: str):
    """(main tokens, tokens inside parentheses)"""
    paren = re.findall(r"\(([^)]*)\)", s)
    main = re.sub(r"\([^)]*\)", " ", s)
    return _tokens(main), [t for p in paren for t in _tokens(p)]


def _significant(tokens: Iterable[str]) -> List[str]:
    return [t for t in tokens if t not in _STOP]


def _initials(tokens: Iterable[str]) -> str:
    return "".join(t[0] for t in _significant(tokens) if t not in _GENERIC or t in _KEEP_IN_INITIALS)


def _key(tokens: Iterable[str]) -> frozenset:
    return frozenset(t for t in _significant(tokens) if t not in _GENERIC)


def _expand(tokens: List[str], other: List[str]) -> List[str]:
    """An acronym token becomes the words it abbreviates when the other name spells them out (aws -> amazon web services)."""
    out: List[str] = []
    sig = _significant(other)
    for t in tokens:
        rep = None
        if 2 <= len(t) <= 6 and t.isalpha():
            for i in range(len(sig)):
                for j in range(i + 2, min(len(sig), i + 7) + 1):
                    if "".join(w[0] for w in sig[i:j]) == t:
                        rep = sig[i:j]
        out += rep if rep else [t]
    return out


def certification_matches(required: str, listed: str) -> bool:
    ta, pa = _parts(required)
    tb, pb = _parts(listed)
    acr_a = set(pa) | ({"".join(ta)} if len(ta) == 1 else set())
    acr_b = set(pb) | ({"".join(tb)} if len(tb) == 1 else set())
    if (acr_a & acr_b) or (acr_a & {_initials(tb)}) or (acr_b & {_initials(ta)}):
        return True
    ka, kb = _key(_expand(ta, tb)), _key(_expand(tb, ta))
    return bool(ka) and ka == kb


# ---------------------------------------------------------------------------------------------------------------------
# Requirements of a job, and the check of one CV
# ---------------------------------------------------------------------------------------------------------------------
def _entries(raw: Any) -> List[Dict[str, Any]]:
    """[{'name': str, 'mandatory': bool}] from what the LLM (or an older record) stored: dicts or bare strings."""
    out: List[Dict[str, Any]] = []
    for item in raw or []:
        if isinstance(item, dict):
            name, mandatory = str(item.get("name") or "").strip(), item.get("mandatory", True)
            if isinstance(mandatory, str):
                mandatory = mandatory.strip().lower() not in {"false", "no", "preferred", "optional", "0"}
        else:
            name, mandatory = str(item or "").strip(), True
        if name:
            out.append({"name": name[:120], "mandatory": bool(mandatory)})
    return out[:10]


def jd_requirements(jd: Optional[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """The language / certification requirements stored with a JD (top level or inside structured_info)."""
    jd = jd or {}
    info = jd.get("structured_info") if isinstance(jd.get("structured_info"), dict) else {}
    pick = lambda key: jd.get(key) or info.get(key) or []                       # noqa: E731
    return {"languages": _entries(pick("required_languages")), "certifications": _entries(pick("required_certifications"))}


def has_requirements(reqs: Dict[str, List[Dict[str, Any]]]) -> bool:
    return bool(reqs and (reqs.get("languages") or reqs.get("certifications")))


def _strings(raw: Any) -> List[str]:
    if isinstance(raw, str):
        raw = [p for p in re.split(r"[,;/|\n]+", raw) if p.strip()]
    return [str(x).strip() for x in (raw or []) if str(x or "").strip()]


def _alternatives(name: str) -> List[str]:
    return [p.strip() for p in re.split(r"\s+or\s+", name, flags=re.I) if p.strip()] or [name]


def check_candidate(reqs: Dict[str, List[Dict[str, Any]]], cv: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One row per requirement: {'type', 'name', 'mandatory', 'status'} for this CV."""
    cv_langs = [n for n in (normalize_language(x) for x in _strings(cv.get("languages"))) if n]
    cv_certs = _strings(cv.get("certifications"))
    rows: List[Dict[str, Any]] = []
    for req in reqs.get("languages", []):
        wanted = normalize_language(req["name"])
        status = "unknown" if not cv_langs else ("met" if wanted and wanted in cv_langs else "missing")
        rows.append({"type": "language", "name": req["name"], "mandatory": req["mandatory"], "status": status})
    for req in reqs.get("certifications", []):
        alts = _alternatives(req["name"])
        if not cv_certs:
            status = "unknown"
        else:
            status = "met" if any(certification_matches(a, c) for a in alts for c in cv_certs) else "missing"
        rows.append({"type": "certification", "name": req["name"], "mandatory": req["mandatory"], "status": status})
    return rows


def adjust_score(score: float, rows: List[Dict[str, Any]]) -> float:
    """``score`` is on the 0-100 scale. Missing mandatory (language or certificate): x factor. Met certificate: + bonus
    (mandatory) or + small bonus (preferred). A met language changes nothing."""
    if not rows or not settings.REQUIREMENTS_MATCHING_ENABLED:
        return score
    missing = sum(1 for r in rows if r["mandatory"] and r["status"] == "missing")
    met = sum(1 for r in rows if r["mandatory"] and r["status"] == "met" and r["type"] == "certification")
    preferred = sum(1 for r in rows if not r["mandatory"] and r["status"] == "met" and r["type"] == "certification")
    adjusted = score * (settings.REQUIREMENT_MISSING_FACTOR ** min(missing, MAX_MISSING_PENALTIES))
    adjusted += settings.REQUIREMENT_MET_BONUS * min(met, MAX_MET_BONUSES)
    adjusted += settings.REQUIREMENT_PREFERRED_BONUS * min(preferred, MAX_MET_BONUSES)
    return max(0.0, min(100.0, adjusted))


def summary_line(rows: List[Dict[str, Any]]) -> str:
    """One line for the LLM scoring prompt, e.g. 'Arabic (mandatory language): listed; ACCA (mandatory certification): not listed'."""
    words = {"met": "listed on the CV", "missing": "NOT among the CV's listed ones", "unknown": "the CV lists none, unknown"}
    return "; ".join(f"{r['name']} ({'mandatory' if r['mandatory'] else 'preferred'} {r['type']}): {words[r['status']]}"
                     for r in rows)
