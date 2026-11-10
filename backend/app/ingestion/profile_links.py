"""A candidate's LinkedIn and GitHub profile links, read from CV text.

Only these two sites are recognised, and every link is rebuilt from the parts we matched (``https://www.linkedin.com/in/<slug>``,
``https://github.com/<user>``), never copied from the document. So whatever is stored, and later shown as a clickable link, is
always a plain https link to one of those two sites; a ``javascript:`` or look-alike address cannot get through.

A LinkedIn link is a person's profile (``/in/`` or ``/pub/``); company pages are not the candidate. A GitHub link is the account
(``github.com/<user>``); a link to one of their repositories is reduced to the account, and GitHub's own pages (``/features``,
``/orgs`` ...) are not accounts.

What is NOT taken as the candidate's: a link that sits inside another address (a Google redirect, an archive link), the template
words people forget to replace (``linkedin.com/in/yourname``), and a GitHub account that is only ever mentioned as somebody's
repository (``github.com/pallets/flask`` in a list of tools). When a CV has several profile links, ``pick_linkedin`` and
``pick_github`` choose the one that looks like the candidate's (its name matches theirs), not simply the first written.
"""
from __future__ import annotations

import re
from typing import Dict, Iterable, List, Optional, Tuple

# not inside a word, an e-mail address ("name@github.com"), a longer host name, or another address ("...?q=https://linkedin.com/in/x")
_BOUNDARY = r"(?<![\w@.\-=/?&%#])"

_LINKEDIN = re.compile(
    _BOUNDARY + r"(?:https?://)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com/(in|pub)/([A-Za-z0-9\-_%.]{3,100})", re.I)
_GITHUB = re.compile(
    _BOUNDARY + r"(?:https?://)?(?:www\.)?github\.com/([A-Za-z0-9](?:[A-Za-z0-9\-]{0,38}))(?![A-Za-z0-9\-])", re.I)

# GitHub addresses that are pages of the site, not people
_GITHUB_RESERVED = frozenset("""about apps blog collections contact customer-stories enterprise events explore features
gist gists issues join login logout marketplace new notifications orgs organizations pricing pulls readme search security
sessions settings signup site sponsors topics trending users""".split())


# The words a template or a guide puts where the real name goes: not anybody's profile
_PLACEHOLDER = re.compile(r"^(?:(?:your|my|the|first|full)[-_]?)?(?:full[-_]?)?(?:name|profile|username|user[-_]?name|user|id|handle|linkedin|github|"
                          r"firstname[-_]?lastname|first[-_]?last|name[-_]?surname)[-_]?(?:here)?\d{0,2}$", re.I)
_PLACEHOLDER_WORDS = frozenset("example sample test demo xxx xxxx abc abcd abcde octocat".split())


def _is_placeholder(slug: str) -> bool:
    low = slug.lower()
    return bool(_PLACEHOLDER.match(low)) or low in _PLACEHOLDER_WORDS


def _clean_slug(slug: str) -> str:
    return slug.strip(".-_%")


def linkedin_url(kind: str, slug: str) -> Optional[str]:
    slug = _clean_slug(slug)
    if len(slug) < 3 or _is_placeholder(slug):
        return None
    return f"https://www.linkedin.com/{kind.lower()}/{slug}"


def github_url(user: str) -> Optional[str]:
    user = user.strip("-")
    if not user or user.lower() in _GITHUB_RESERVED or _is_placeholder(user):
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


def github_repo_only(text: str, extra: str = "") -> List[str]:
    """The GitHub accounts that are only ever written as a path into one of their repositories (``github.com/pallets/flask``), never
    as the account itself (``github.com/pallets``). Somebody's own CV links its own account; a repository of another account in a list
    of tools is not the candidate."""
    bare: set = set()
    repo: List[str] = []
    for chunk in (text or "", extra or ""):
        for m in _GITHUB.finditer(chunk):
            account = github_url(m.group(1))
            if not account:
                continue
            after = chunk[m.end():m.end() + 2]
            if len(after) == 2 and after[0] == "/" and after[1].isalnum():
                repo.append(account)
            else:
                bare.add(account.lower())
    return _first_seen(a for a in repo if a.lower() not in bare)


def _identity(name: Optional[str], email: Optional[str]) -> Tuple[List[str], str]:
    """The words of the candidate's name and the first part of their e-mail address, to tell their own profile from somebody else's."""
    words = [w for w in re.split(r"[^a-z]+", (name or "").lower()) if len(w) >= 3]
    local = re.sub(r"[^a-z0-9]", "", (email or "").split("@")[0].lower())
    return words, local


def _affinity(slug: str, words: List[str], local: str) -> int:
    flat = re.sub(r"[^a-z0-9]", "", slug.lower())
    score = sum(1 for w in words if w in flat)
    if len(local) >= 4 and (local in flat or (len(flat) >= 4 and flat in local)):
        score += 1
    return score


def pick_linkedin(links: Iterable[str], name: Optional[str] = None, email: Optional[str] = None) -> Optional[str]:
    """The candidate's own LinkedIn profile among those found: the one whose address resembles their name or e-mail, else the first
    written (a CV opens with its owner's details; a recommender or referee comes later)."""
    found = [u for u in links if u]
    if not found:
        return None
    words, local = _identity(name, email)
    best = max(range(len(found)), key=lambda i: (_affinity(found[i].rsplit("/", 1)[-1], words, local), -i))
    return found[best]


def pick_github(accounts: Iterable[str], repo_only: Iterable[str] = (), name: Optional[str] = None, email: Optional[str] = None) -> Optional[str]:
    """The candidate's own GitHub account: the one that resembles their name or e-mail; failing that, the first one written as an
    account (not as somebody's repository). An account that only appears as a repository path and does not resemble the candidate is
    taken as a tool they mention, not as them."""
    found = [a for a in accounts if a]
    if not found:
        return None
    words, local = _identity(name, email)
    scores = [_affinity(a.rsplit("/", 1)[-1], words, local) for a in found]
    top = max(scores)
    if top > 0:
        return found[scores.index(top)]
    only_repos = {a.lower() for a in repo_only}
    for a in found:
        if a.lower() not in only_repos:
            return a
    return None
