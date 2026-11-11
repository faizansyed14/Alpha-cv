"""The first gate: decides, WITHOUT calling a model, whether a message may go any further.

Order: empty, too long, anything that asks to delete or remove (always refused, whatever the wording), prompt injection,
small talk (predefined, instant, free), off-topic. Every refusal is a fixed reply that offers clickable next steps.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List

from app.agents import smalltalk
from app.agents.scope import _OFF_TOPIC  # the shared off-topic pattern
from app.security.llm_guard import injection_flags

MAX_MESSAGE_CHARS = 4000            # a pasted Boolean string may be 4,000 characters

# Anything that asks for something to be deleted, removed or made to disappear. Deliberately broad: Agentic mode never
# deletes, so a false alarm costs one rephrase while a miss would be a deletion request reaching the model.
_DELETE = re.compile(
    r"\b(?:delete[sd]?|deleting|remov(?:e|es|ed|ing|al)|eras(?:e|es|ed|ing)|wip(?:e|es|ed|ing)|purg(?:e|es|ed|ing)|"
    r"destroy(?:s|ed|ing)?|truncat(?:e|es|ed|ing)|trash(?:ed|ing)?|discard(?:s|ed|ing)?|unpublish(?:ed|ing)?|"
    r"get(?:ting)?\s+rid\s+of|take\s+[\w\s]{0,40}?\b(?:down|offline)\b|nuke[sd]?|clear\s+(?:out|all)|clean\s+out)\b", re.I)

_ATS_TERMS = re.compile(
    r"\b(?:jobs?|candidates?|cvs?|resumes?|applicants?|applications?|match(?:ing|es)?|interview\w*|linkedin|posts?|hir(?:e|ing)|"
    r"vacanc\w+|positions?|roles?|jds?|shortlist\w*|pipeline|skills?|experience|salary|recruit\w*|"
    r"openings?|screen\w*|review\w*|search\w*|find|list|show|top|best|draft|publish|create|post|usage|tokens?|reset|notes?|notice|status|"
    r"close|reopen|upload|reminders?|health|users?|approve|reject)\b", re.I)


@dataclass
class Verdict:
    ok: bool
    kind: str = ""                 # empty | too_long | delete | injection | smalltalk | off_topic
    reply: str = ""                # fixed text, never from a model
    suggestions: List[str] = field(default_factory=list)


def _clean(message: str) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", message or "").strip()


def inspect(message: str, *, role: str, examples: List[str], pending_draft: bool = False) -> Verdict:
    text = _clean(message)
    if len(text) < 2:
        return Verdict(False, "empty", "Tell me what you'd like to do. For example:", examples[:3])
    if len(text) > MAX_MESSAGE_CHARS:
        return Verdict(False, "too_long", f"Please keep your message under {MAX_MESSAGE_CHARS:,} characters.")
    if _DELETE.search(text):
        return Verdict(False, "delete",
                       "I can't delete or remove anything. That is blocked on purpose in Agentic mode. I can read, create, match, review, write, "
                       "and make changes that you confirm. Here is what I can do:", examples[:4])
    if injection_flags(text):
        return Verdict(False, "injection", "I can't act on instructions that try to change how I work. Tell me the task itself.", examples[:3])
    kinds = smalltalk.classify(text, allow_ack=not pending_draft)      # "ok" confirms a waiting draft, so it is not small talk then
    if kinds:
        reply, chips = smalltalk.reply(
            kinds, name="Alpha assistant", does="can post jobs, search and review candidates, run matching, and write interview questions and LinkedIn posts",
            has_job=True, text=text, examples=examples, job_hint="")
        return Verdict(False, "smalltalk", reply, chips)
    if _OFF_TOPIC.search(text) and not _ATS_TERMS.search(text):
        return Verdict(False, "off_topic", "That's outside what I do. I help with recruiting work in this application. Try one of these:", examples[:4])
    return Verdict(True)
