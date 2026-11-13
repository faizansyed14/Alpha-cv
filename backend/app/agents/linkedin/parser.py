"""Reads and checks the LinkedIn Job Post Agent's plain-text answer before anyone sees it."""
from __future__ import annotations

import re
import unicodedata
from typing import List, Optional

from app.agents.base import OutputRejected, Parsed, clean, refusal_of, tidy

LINKEDIN_MAX_CHARS = 3000          # LinkedIn's own limit for a post
LINKEDIN_MAX_HASHTAGS = 12

_MONEY = re.compile(r"(?:AED|USD|EUR|GBP|SAR|QAR|INR|\$|€|£)\s?\d[\d,\.]*(?:\s?[kKmM])?|\d[\d,\.]*\s?(?:AED|USD|SAR|QAR|k/month|per month)", re.I)
_HASHTAGS = re.compile(r"^\s*HASHTAGS?\s*:\s*(.*)$", re.I | re.M)
_POST_LABEL = re.compile(r"^\s*POST\s*:\s*", re.I)
_URL = re.compile(r"https?://\S+")
_APPLY_HINT = re.compile(r"apply", re.I)


def _ungrounded_figures(post: str, jd_text: str) -> List[str]:
    jd_digits = re.sub(r"\D", "", jd_text)
    out = []
    for m in _MONEY.finditer(post):
        figure = m.group(0).strip()
        digits = re.sub(r"\D", "", figure)
        if digits and digits not in jd_digits:
            out.append(figure)
    return list(dict.fromkeys(out))[:5]


def _plain(line: str) -> str:
    """The line with maths-bold and other styled letters turned into ordinary ones, so "𝗔𝗽𝗽𝗹𝘆 𝗡𝗼𝘄" is read as "Apply Now"."""
    return unicodedata.normalize("NFKC", line)


def ensure_apply_url(post: str, apply_url: Optional[str]) -> str:
    """The post carries this job's real public URL ONCE, on the Apply Now line (never a short link the model invented).

    The first line that looks like an apply line (it says apply, in plain or bold letters, and has a link, or it already holds this URL) is
    pinned to the real URL. Every other apply link the model wrote (a second "Apply here" at the end, a shortened copy) is taken out: a line
    that is only a label goes, a line with other words keeps them without the link. Running it again changes nothing."""
    url = (apply_url or "").strip()
    if not url:
        return post
    lines = post.splitlines()
    candidates = [i for i, line in enumerate(lines) if _URL.search(line) and (_APPLY_HINT.search(_plain(line)) or url in line)]
    if candidates:
        first = candidates[0]
        found = _URL.search(lines[first])
        lines[first] = lines[first][:found.start()] + url + _URL.sub("", lines[first][found.end():]).rstrip()
        drop = set()
        for i in candidates[1:]:
            rest = _URL.sub("", lines[i]).rstrip()
            if len(re.findall(r"[A-Za-z]+", _plain(rest))) <= 5:           # only a label like "Apply here:"
                drop.add(i)
            else:
                lines[i] = rest
        lines = [line for i, line in enumerate(lines) if i not in drop]
        return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip("\n")
    insert_at = 1
    for i, line in enumerate(lines):
        if "location" in line.lower() or "📍" in line:
            insert_at = i + 1
            break
    lines.insert(insert_at, f"👉 Apply Now: {url}")
    if insert_at < len(lines) - 1 and lines[insert_at + 1].strip():
        lines.insert(insert_at + 1, "")
    return "\n".join(lines)


def parse_linkedin(text: str, jd_text: str, apply_url: Optional[str] = None) -> Parsed:
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
    post = ensure_apply_url(post, apply_url)
    if len(post) < 80:
        raise OutputRejected("the post is empty or too short")
    if len(post) > LINKEDIN_MAX_CHARS:
        raise OutputRejected(f"the post is longer than LinkedIn's {LINKEDIN_MAX_CHARS} characters")
    tags: List[str] = []
    for t in re.split(r"[\s,]+", tag_line):
        tag = "#" + re.sub(r"[^\w]", "", t)
        if len(tag) > 2 and tag.lower() not in [x.lower() for x in tags]:
            tags.append(tag)
    tags = tags[:LINKEDIN_MAX_HASHTAGS]
    warnings = [f'The post mentions "{figure}", which is not in the job description. Check it before publishing.'
                for figure in _ungrounded_figures(post, jd_text)]
    content = post + ("\n\n" + " ".join(tags) if tags else "")
    return Parsed(True, content=content, meta={"type": "linkedin", "post": post, "hashtags": tags, "chars": len(post)}, warnings=warnings)
