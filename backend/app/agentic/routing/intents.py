"""Keyword rules that say which specialist a message is for. Strong patterns score 3, weak ones 1; the router reads the totals."""
from __future__ import annotations

import re
from typing import Dict, List, Tuple

_I = re.I

# (pattern, weight). Written to be specific: "post a job" is the jobs specialist, "write a linkedin post" is linkedin.
RULES: Dict[str, List[Tuple["re.Pattern[str]", int]]] = {
    "jobs": [
        (re.compile(r"\b(?:close|reopen|re-open|deactivate|activate|rename|edit|change|update|amend)\b.{0,45}\b(?:job|posting|vacancy|opening)\b", _I), 3),
        (re.compile(r"\b(?:upload|save|add)\b.{0,25}\b(?:jds?|job\s+descriptions?)\b", _I), 3),
        (re.compile(r"\b(?:application\s+trends?|how\s+many\s+applications|applications\s+(?:this|last|per|in\s+the)\b)", _I), 3),
        (re.compile(r"\b(?:post|create|publish|open|draft|add|advertise)\b.{0,25}\b(?:job|vacanc\w+|position|opening|role|requisition)\b(?!.{0,30}\blinked\s?in\b)", _I), 3),
        (re.compile(r"\b(?:job|vacancy)\s+(?:post(?:ing)?|ad|advert)\b", _I), 3),
        (re.compile(r"\b(?:open\s+(?:jobs|roles|positions)|our\s+jobs|jobs\s+(?:we|that)|list\s+(?:the\s+)?jobs|show\s+(?:me\s+)?(?:the\s+)?jobs)\b", _I), 3),
        (re.compile(r"\b(?:list|show|see|view|display|what|which|all)\b.{0,25}\b(?:jds?|job\s+descriptions?)\b", _I), 3),     # "show me all JDs"
        (re.compile(r"\b(?:jobs?|vacanc\w+|postings?|careers?|jds?|job\s+descriptions?)\b", _I), 1),
    ],
    "matching": [
        (re.compile(r"\b(?:match|matching|matched|best\s+fits?|rank|ranking|shortlist\w*|top\s+candidates|who\s+(?:fits|suits|is\s+best))\b", _I), 3),
        (re.compile(r"\b(?:fit|suitable|score|scores)\b", _I), 1),
        (re.compile(r"\bcategor(?:y|ies)\b", _I), 3),                                    # "show me categories": the CV categories, for matching
    ],
    "candidates": [
        (re.compile(r"\b(?:notes?)\b.{0,30}\b(?:candidate|cv|profile|him|her|them)\b|\b(?:add|write|save|leave|read|show|see)\b.{0,15}\bnotes?\b", _I), 3),
        (re.compile(r"\b(?:upload|save|add)\b.{0,25}\b(?:cvs?|resumes?)\b", _I), 3),
        (re.compile(r'(?:\([^()]*\)|"[^"]+")\s*(?:AND|OR|NOT)\b|\b(?:AND|OR|NOT)\s*[("]'), 4),           # a pasted Boolean string (upper-case operators)
        (re.compile(r"\bboolean\b", _I), 3),
        (re.compile(r"\b(?:review|find|search|look\s+for|look\s+up|show)\b.{0,30}\b(?:candidates?|cvs?|resumes?|profiles?|people|developers?|engineers?|applicants?)\b", _I), 3),
        (re.compile(r"\b(?:who\s+applied|applicants?|applications?)\b", _I), 3),
        (re.compile(r"\b(?:candidates?|cvs?|resumes?|profiles?)\b", _I), 1),
    ],
    "interview": [
        (re.compile(r"\binterview\w*\b", _I), 3),
        (re.compile(r"\b(?:screening|technical|behaviou?ral)\s+questions?\b", _I), 3),
        (re.compile(r"\bquestions?\s+(?:for|to\s+ask)\b", _I), 2),
    ],
    "linkedin": [
        (re.compile(r"\blinked\s?in\b", _I), 4),
        (re.compile(r"\b(?:social\s+media|hashtags?)\b", _I), 3),
        (re.compile(r"\b(?:write|draft|generate)\b.{0,20}\bpost\b", _I), 1),
    ],
    "tracker": [
        (re.compile(r"\btracker\b", _I), 4),
        (re.compile(r"\bfollow[- ]?ups?\b", _I), 3),
        (re.compile(r"\b(?:pipeline|selections?|stage|reminders?)\b", _I), 1),
        (re.compile(r"\b(?:job\s+openings?|tracker\s+candidates?)\b", _I), 2),
    ],
    "admin": [
        (re.compile(r"\b(?:tokens?|ai\s+usage|token\s+usage|reset\s+requests?|usage\s+(?:today|overview))\b", _I), 3),
        (re.compile(r"\b(?:notice|announcement|system\s+(?:status|health)|is\s+the\s+system|weekly\s+report|list\s+(?:the\s+)?users|who\s+has\s+an\s+account)\b", _I), 3),
        (re.compile(r"\b(?:approve|reject)\b.{0,25}\b(?:requests?|reset)\b", _I), 3),
    ],
}


_WANTS_LIST = re.compile(
    r"\b(?:list|show|see|view|display|browse|find|search|look\s+for|what|which|all|any)\b.{0,30}\b(?:jobs?|postings?|jds?|job\s+descriptions?|openings?|vacanc\w+|"
    r"candidates?|cvs?|resumes?|people|developers?|engineers?|profiles?|applicants?)\b", _I)


def wants_list(message: str) -> bool:
    """True when the person asked to SEE a list ("show me all JDs", "find python developers"). Anything else that reads a list is a
    lookup for some other task and is kept off the screen."""
    return bool(_WANTS_LIST.search(message or ""))


def score(message: str) -> Dict[str, int]:
    totals: Dict[str, int] = {}
    for name, rules in RULES.items():
        total = sum(weight for pattern, weight in rules if pattern.search(message))
        if total:
            totals[name] = total
    return totals
