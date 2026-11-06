"""The write-confirmation rule: a job is only posted after the person said yes to the draft they were shown.

The check is code, not the model's judgement. A plain yes confirms, including the wording of the on-screen button ("Yes, post it").
"yes, but change the title" is NOT a confirmation, and neither is any message that adds something else.
"""
from __future__ import annotations

import re

_YES_WORD = (r"(?:yes|yep|yeah|yup|y|sure|ok(?:ay)?|confirm(?:ed)?|go\s+ahead|do\s+it|please\s+do|looks\s+good|that'?s\s+good|approved?|proceed|"
             r"send\s+it|go\s+for\s+it|post\s+it|publish(?:\s+it)?)")
_TAIL = r"(?:please|thanks|thank\s+you|now|it|then|post(?:\s+it)?|publish(?:\s+it)?|go\s+ahead|do\s+it|confirm(?:ed)?)"
_YES = re.compile(rf"^\W*{_YES_WORD}(?:[\s,.!-]+{_TAIL})*\W*$", re.I)
_NO = re.compile(r"^\W*(?:no|nope|cancel|stop|don'?t|do\s+not|wait|hold\s+on|not\s+yet|never\s*mind)\b", re.I)
_CANCEL = re.compile(r"^\W*(?:no|nope|cancel|stop|never\s*mind|not\s+yet|(?:don'?t|do\s+not)\s+(?:post|publish)(?:\s+it)?)\W*$", re.I)


def is_confirmation(text: str) -> bool:
    t = (text or "").strip()
    return 0 < len(t) <= 60 and bool(_YES.match(t)) and not _NO.match(t)


def is_cancellation(text: str) -> bool:
    """A plain "no" or "cancel". "No, change the location to Dubai" is a change request, not a cancellation."""
    return bool(_CANCEL.match((text or "").strip()))
