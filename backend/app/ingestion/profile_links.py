"""A candidate's LinkedIn and GitHub profile links, read from CV text.

Only these two sites are recognised, and every link is rebuilt from the parts we matched (``https://www.linkedin.com/in/<slug>``,
``https://github.com/<user>``), never copied from the document. So whatever is stored, and later shown as a clickable link, is
always a plain https link to one of those two sites; a ``javascript:`` or look-alike address cannot get through.

A LinkedIn link is a person's profile (``/in/`` or ``/pub/``); company pages are not the candidate. A GitHub link is the account
(``github.com/<user>``); a link to one of their repositories is reduced to the account, and GitHub's own pages (``/features``,
``/orgs`` ...) are not accounts.
"""
from __future__ import annotations

import re
from typing import Dict, Iterable, List, Optional, Tuple

_BOUNDARY = r"(?<![\w@.\-])"           # not inside a word or an e-mail address ("name@github.com") or a longer host name

_LINKEDIN = re.compile(
    _BOUNDARY + r"(?:https?://)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com/(in|pub)/([A-Za-z0-9\-_%.]{2,100})", re.I)
_GITHUB = re.compile(
    _BOUNDARY + r"(?:https?://)?(?:www\.)?github\.com/([A-Za-z0-9](?:[A-Za-z0-9\-]{0,38}))(?![A-Za-z0-9\-])", re.I)

# GitHub addresses that are pages of the site, not people
_GITHUB_RESERVED = frozenset("""about apps blog collections contact customer-stories enterprise events explore features
gist gists issues join login logout marketplace new notifications orgs organizations pricing pulls readme search security
sessions settings signup site sponsors topics trending users""".split())


def _clean_slug(slug: str) -> str:
    return slug.strip(".-_%")


def linkedin_url(kind: str, slug: str) -> Optional[str]:
    slug = _clean_slug(slug)
    return f"https://www.linkedin.com/{kind.lower()}/{slug}" if len(slug) >= 2 else None


def github_url(user: str) -> Optional[str]:
    user = user.strip("-")
    if not user or user.lower() in _GITHUB_RESERVED:
        return None
    return f"https://github.com/{user}"


def normalize_linkedin(value: object) -> Optional[str]:
    """A clean LinkedIn profile link from whatever was stored (a link, or ``linkedin.com/in/name``); None if it is not one."""
    m = _LINKEDIN.search(str(value or "").strip())
    return linkedin_url(m.group(1), m.group(2)) if m else None


def normalize_github(value: object) -> Optional[str]:
    m = _GITHUB.search(str(value or "").strip())
    return github_url(m.group(1)) if m else None


def _first_seen(items: Iterable[Optional[str]]) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in items:
        if item and item.lower() not in seen:
            seen.add(item.lower())
            out.append(item)
    return out


def profile_link_spans(text: str) -> List[Tuple[int, int, str]]:
    """(start, end, "[LINKEDIN]" or "[GITHUB]") for every profile link in ``text``, so it can be blanked out before the text is sent
    to the AI model. A span runs to the end of the written address (a repository path after the account name is included)."""
    spans: List[Tuple[int, int, str]] = []
    for pattern, placeholder in ((_LINKEDIN, "[LINKEDIN]"), (_GITHUB, "[GITHUB]")):
        for m in pattern.finditer(text or ""):
            end = m.end()
            while end < len(text) and not text[end].isspace():
                end += 1
            while end > m.end() and text[end - 1] in ".,;:)]>\"'":
                end -= 1
            spans.append((m.start(), end, placeholder))
    return spans


def find_profile_links(text: str, extra: str = "") -> Dict[str, List[str]]:
    """{"linkedin": [...], "github": [...]}: every profile link in ``text``, in document order. ``extra`` is more text to read after
    it (the addresses behind clickable words such as "LinkedIn", which the visible text does not contain)."""
    found: Dict[str, List[str]] = {"linkedin": [], "github": []}
    for chunk in (text or "", extra or ""):
        found["linkedin"] += [linkedin_url(m.group(1), m.group(2)) for m in _LINKEDIN.finditer(chunk)]       # type: ignore[list-item]
        found["github"] += [github_url(m.group(1)) for m in _GITHUB.finditer(chunk)]                         # type: ignore[list-item]
    return {k: _first_seen(v) for k, v in found.items()}
