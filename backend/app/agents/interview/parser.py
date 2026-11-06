"""Reads and checks the Interview Question Agent's plain-text answer before anyone sees it.

The layout is forgiving on purpose: a missing ``---`` line, a field that wraps onto a second line, or an answer cut off at the
length limit still yields every complete question that came before the break.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

from app.agents.base import OutputRejected, Parsed, clean, refusal_of, tidy
from app.agents.interview.prompt import MAX_QUESTIONS
from app.ingestion.search_index import normalize

_CATEGORIES = {"technical": "Technical", "behavioural": "Behavioural", "behavioral": "Behavioural", "situational": "Situational",
               "experience": "Experience", "culture fit": "Culture fit", "culture": "Culture fit"}
_DIFFICULTY = {"easy": "Easy", "medium": "Medium", "hard": "Hard"}

_KEY = re.compile(r"^\s*(?:[-*]\s*)?(ROLE|CATEGORY|DIFFICULTY|QUESTION|BASED_ON|LISTEN_FOR|FOLLOW_UP)\s*:\s*(.*)$", re.I)
_SEPARATOR = re.compile(r"^\s*-{3,}\s*$")


def _read(text: str) -> tuple[str, List[Dict[str, str]]]:
    role = ""
    blocks: List[Dict[str, str]] = []
    cur: Dict[str, str] = {}
    last: Optional[str] = None

    def push() -> None:
        nonlocal cur, last
        if cur.get("QUESTION"):
            blocks.append(cur)
        cur, last = {}, None

    for line in tidy(text).splitlines():
        if _SEPARATOR.match(line):
            push()
            continue
        m = _KEY.match(line)
        if m:
            key, value = m.group(1).upper(), m.group(2).strip()
            if key == "ROLE":
                role = value
                continue
            if key == "CATEGORY" and cur.get("QUESTION"):       # the model left out the separator
                push()
            cur[key] = value
            last = key
        elif line.strip() and last:                                # a field that wrapped onto another line
            cur[last] = f"{cur.get(last, '')} {line.strip()}".strip()
    push()
    return role, blocks


def parse_interview(text: str, jd_text: str) -> Parsed:
    refusal = refusal_of(text)
    if refusal is not None:
        return Parsed(False, refusal)
    role, blocks = _read(text)
    if not blocks:
        raise OutputRejected("no questions in the answer")
    questions: List[Dict[str, str]] = []
    seen = set()
    for b in blocks[:MAX_QUESTIONS]:
        q = clean(b.get("QUESTION"), 600)
        if len(q) < 10 or normalize(q) in seen:
            continue
        seen.add(normalize(q))
        questions.append({
            "category": _CATEGORIES.get(b.get("CATEGORY", "").strip().lower(), "Technical"),
            "difficulty": _DIFFICULTY.get(b.get("DIFFICULTY", "").strip().lower(), "Medium"),
            "question": q,
            "listen_for": clean(b.get("LISTEN_FOR"), 500),
            "follow_up": clean(b.get("FOLLOW_UP"), 400),
            "based_on": clean(b.get("BASED_ON"), 160),
        })
    if not questions:
        raise OutputRejected("no usable questions in the answer")
    role = clean(role, 120)
    lines = [f"Interview questions{f' for {role}' if role else ''}", ""]
    for i, q in enumerate(questions, 1):
        lines.append(f"{i}. [{q['category']} | {q['difficulty']}] {q['question']}")
        if q["based_on"]:
            lines.append(f"   From the CV: {q['based_on']}")
        if q["listen_for"]:
            lines.append(f"   Listen for: {q['listen_for']}")
        if q["follow_up"]:
            lines.append(f"   Follow-up: {q['follow_up']}")
        lines.append("")
    return Parsed(True, content="\n".join(lines).strip(), meta={"type": "interview", "role": role, "questions": questions})
