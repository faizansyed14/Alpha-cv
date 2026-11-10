"""What goes into the model and what comes out of it.

Tool results are DATA: they are wrapped in a labelled block with any prompt-delimiter tags neutralised, contact details are
masked, and they are cut to a fixed size. The model's reply is cleaned: internal ids are removed (people read names, not ids),
markdown bold is dropped and the length is capped.
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.security.llm_guard import mask_pii, sanitize_untrusted

_UUID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
_TAGS = re.compile(r"</?\s*(?:system|assistant|user|tool_result|tool|instructions?)\s*>", re.I)
_FENCE = re.compile(r"```[a-zA-Z]*")


def wrap_tool_result(name: str, data: Any, limit: int) -> str:
    """The text the model receives for a tool call."""
    try:
        body = json.dumps(data, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        body = str(data)
    body = mask_pii(_TAGS.sub(lambda m: m.group(0).replace("<", "‹").replace(">", "›"), body))
    if len(body) > limit:
        body = body[:limit] + ' ... [cut: ask for fewer or narrower results]'
    return f"<tool_result name=\"{name}\">{body}</tool_result>"


def safe_text(value: Any, limit: int) -> str:
    """One piece of text from a document or profile, made safe to show the model."""
    return sanitize_untrusted(mask_pii(str(value or "")), limit).strip()


def clean_answer(text: str, *, limit: int = 3500) -> str:
    out = _FENCE.sub("", text or "").replace("**", "").replace("__", "")
    out = _UUID.sub("", out)
    out = _TAGS.sub("", out)
    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\(\s*\)|\[\s*\]", "", out)                       # what is left of a removed id
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out[:limit]
