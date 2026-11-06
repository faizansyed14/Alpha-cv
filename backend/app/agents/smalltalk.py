"""Predefined answers to small talk: "hi", "hello, how are you?", "thanks", "who are you", "what can you do" ...

These never reach the model, so they cost nothing and answer instantly. They are not one canned line: the message is
split into the kinds of thing it says (a greeting AND a how-are-you, say), each kind gets its own sentence, and the
reply ends with what to do next, depending on whether a job is already attached. A message counts as small talk only when
nothing else is left once the pleasantries are taken out, so "hi, write me a post" still goes through as a real request.
"""
from __future__ import annotations

import re
import zlib
from typing import Dict, List, Optional, Tuple

# order matters: longer phrases first, so "how are you" is not eaten by a shorter pattern
_PHRASES: List[Tuple[str, str]] = [
    ("how_are_you", r"(?:how\s+are\s+(?:you|u)(?:\s+doing|\s+today)?|how\s+r\s+u|how'?s\s+it\s+going|how\s+is\s+it\s+going|how\s+do\s+you\s+do|how\s+have\s+you\s+been|how\s+is\s+your\s+day|what'?s\s+up|whats\s+up|wassup|sup)"),
    ("identity", r"(?:who\s+are\s+(?:you|u)|what\s+are\s+(?:you|u)|what(?:'s|\s+is)\s+your\s+name|your\s+name|are\s+you\s+(?:a\s+|an\s+)?(?:bot|ai|human|robot|real|chatgpt))"),
    ("help", r"(?:what\s+can\s+you\s+do|what\s+do\s+you\s+do|how\s+can\s+you\s+help(?:\s+me)?|how\s+does\s+this\s+work|how\s+do\s+i\s+use\s+this|help(?:\s+me)?|menu|options|commands)"),
    ("thanks", r"(?:thanks?(?:\s+a\s+lot|\s+so\s+much)?|thank\s+you(?:\s+so\s+much|\s+very\s+much)?|thx|ty|cheers|much\s+appreciated|appreciate\s+it)"),
    ("bye", r"(?:bye+|goodbye|good\s+night|see\s+(?:you|ya)(?:\s+later)?|cya|take\s+care|talk\s+later|later)"),
    ("greeting", r"(?:hi+|hello+|hey+|heya|hiya|howdy|yo|hola|salam|salaam|assalam\w*|marhaba|namaste|greetings|good\s+(?:morning|afternoon|evening|day))"),
    ("ack", r"(?:ok(?:ay)?|okey|k|cool|nice|great|awesome|good|perfect|alright|got\s+it|fine|wow|hmm+|test(?:ing)?|ping|lol)"),
]

# words that may sit around the pleasantries without being a request
_FILLER = {"there", "team", "bot", "assistant", "agent", "ai", "everyone", "all", "buddy", "friend", "mate", "dear", "sir", "madam",
           "please", "pls", "and", "to", "you", "u", "today", "again", "so", "much", "very", "a", "lot", "the", "my", "guys", "folks",
           "man", "bro", "alpha", "cv", "there's", "thereâ"}


def classify(text: str, *, allow_ack: bool = True) -> Optional[List[str]]:
    """The kinds of small talk the message consists of (in the order they were found), or None if it holds anything else."""
    t = re.sub(r"[^\w\s']", " ", (text or "").lower().replace("’", "'"))
    t = re.sub(r"\s+", " ", t).strip()
    if not t or len(t) > 90:
        return None
    found: List[str] = []
    rest = f" {t} "
    for kind, pattern in _PHRASES:
        if kind == "ack" and not allow_ack:
            continue
        rest, n = re.subn(rf"(?<!\w){pattern}(?!\w)", " ", rest)
        if n:
            found.append(kind)
    leftover = [w for w in rest.split() if w not in _FILLER]
    return found if found and not leftover else None


_OPENERS: Dict[str, List[str]] = {
    "greeting": ["Hello!", "Hi there!", "Hey!"],
    "how_are_you": ["I'm doing well, thanks for asking.", "All good here, thank you for asking.", "Doing great, thanks."],
    "thanks": ["You're welcome!", "Happy to help.", "Anytime."],
    "ack": ["Great.", "Sounds good.", "Perfect."],
    "bye": ["Goodbye! Come back any time.", "See you soon.", "Take care!"],
}


def reply(kinds: List[str], *, name: str, does: str, has_job: bool, text: str, examples: List[str], job_hint: str) -> Tuple[str, List[str]]:
    """The reply and the suggestion chips. ``does`` completes "I {does}"; ``job_hint`` says how to get started."""
    pick = zlib.crc32(text.lower().encode("utf-8"))
    parts: List[str] = []
    for kind in ("greeting", "how_are_you", "thanks", "ack"):
        if kind in kinds:
            variants = _OPENERS[kind]
            parts.append(variants[pick % len(variants)])
    if "identity" in kinds:
        parts.append(f"I'm the {name}.")
    if "identity" in kinds or "help" in kinds or "greeting" in kinds or "how_are_you" in kinds:
        parts.append(f"I {does}.")
    if "bye" in kinds:
        parts.append(_OPENERS["bye"][pick % len(_OPENERS["bye"])])
        return " ".join(parts), []
    parts.append("What would you like to do? Here are a few ideas:" if has_job else job_hint)
    return " ".join(parts), list(examples[:3])
