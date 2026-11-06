"""Reads and checks the LinkedIn Job Post Agent's plain-text answer before anyone sees it."""
from __future__ import annotations

import re
from typing import List

from app.agents.base import OutputRejected, Parsed, clean, refusal_of, tidy

LINKEDIN_MAX_CHARS = 3000          # LinkedIn's own limit for a post

_MONEY = re.compile(r"(?:AED|USD|EUR|GBP|SAR|QAR|INR|\$|€|£)\s?\d[\d,\.]*(?:\s?[kKmM])?|\d[\d,\.]*\s?(?:AED|USD|SAR|QAR|k/month|per month)", re.I)
_HASHTAGS = re.compile(r"^\s*HASHTAGS?\s*:\s*(.*)$", re.I | re.M)
_POST_LABEL = re.compile(r"^\s*POST\s*:\s*", re.I)


def _ungrounded_figures(post: str, jd_text: str) -> List[str]:
    jd_digits = re.sub(r"\D", "", jd_text)
    out = []
    for m in _MONEY.finditer(post):
        figure = m.group(0).strip()
        digits = re.sub(r"\D", "", figure)
        if digits and digits not in jd_digits:
            out.append(figure)
    return list(dict.fromkeys(out))[:5]


def parse_linkedin(text: str, jd_text: str) -> Parsed:
    refusal = refusal_of(text)
    if refusal is not None:
        return Parsed(False, refusal)
    body = tidy(text)
    tag_line = ""
    matches = list(_HASHTAGS.finditer(body))
    if matches:                                              # the last HASHTAGS line closes the answer
        tag_line = matches[-1].group(1)
        body = body[:matches[-1].start()]
    body = _POST_LABEL.sub("", body.lstrip(), count=1)
    post = clean(body, LINKEDIN_MAX_CHARS + 500)
    post = re.sub(r"__", "", post)                           # LinkedIn shows these literally
    post = post.replace("—", ", ").replace("–", "-")   # no long dashes
    if len(post) < 80:
        raise OutputRejected("the post is empty or too short")
    if len(post) > LINKEDIN_MAX_CHARS:
        raise OutputRejected(f"the post is longer than LinkedIn's {LINKEDIN_MAX_CHARS} characters")
    tags: List[str] = []
    for t in re.split(r"[\s,]+", tag_line):
        tag = "#" + re.sub(r"[^\w]", "", t)
        if len(tag) > 2 and tag.lower() not in [x.lower() for x in tags]:
            tags.append(tag)
    tags = tags[:5]
    warnings = [f'The post mentions "{figure}", which is not in the job description. Check it before publishing.'
                for figure in _ungrounded_figures(post, jd_text)]
    content = post + ("\n\n" + " ".join(tags) if tags else "")
    return Parsed(True, content=content, meta={"type": "linkedin", "post": post, "hashtags": tags, "chars": len(post)}, warnings=warnings)
