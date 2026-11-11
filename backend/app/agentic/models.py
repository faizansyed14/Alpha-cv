"""Which model does what. One role = one OpenRouter model id in the settings; an empty value means ``LLM_MODEL``.

    router    picks the specialist when the keyword rules are unsure (tiny prompt, a few hundred tokens)
    act       the specialists' tool-using model (reads tool results, decides the next step, writes the reply)
    write     long-form writing inside tools (interview questions, LinkedIn posts)
    fallback  tried once when a call above fails with a transport error (timeout, 5xx, rate limit, empty reply)

Keeping roles apart means a cheaper model can route, a stronger one can write, and a second provider can stand in when the
first is down, without touching any other code.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from app.config.settings import settings
from app.providers.llm.service import LLMResponse, get_llm_service

logger = logging.getLogger(__name__)

ROLES = ("router", "act", "write", "fallback")


def model_for(role: str) -> str:
    chosen = {
        "router": settings.AGENTIC_MODEL_ROUTER,
        "act": settings.AGENTIC_MODEL_ACT,
        "write": settings.AGENTIC_MODEL_WRITE,
        "fallback": settings.AGENTIC_MODEL_FALLBACK,
    }.get(role, "")
    return (chosen or "").strip() or settings.LLM_MODEL


def _fallback_model() -> str:
    return (settings.AGENTIC_MODEL_FALLBACK or "").strip()


def _transport_failure(response: Optional[LLMResponse]) -> bool:
    if response is None:
        return True
    message = (response.error_message or "").lower()
    return any(word in message for word in ("timeout", "api error: 5", "api error: 429", "empty response", "connection"))


def _send(messages: List[Dict[str, Any]], model: str, max_tokens: int, tools: Optional[List[Dict[str, Any]]], role: str, cache: str) -> Optional[LLMResponse]:
    try:
        return get_llm_service()._call_openai_api(
            messages=messages, model=model, max_tokens=max_tokens, json_schema=None, raw=True, tools=tools,
            timeout=settings.AGENT_TIMEOUT_SECONDS, role=f"agentic_{role}", detail={"role": role}, cache=cache)
    except Exception as exc:  # noqa: BLE001 - a missing key or a transport failure is handled like any failed call
        logger.error(f"Agentic {role} call failed to start: {str(exc)[:200]}")
        return None


def complete(messages: List[Dict[str, Any]], *, role: str, max_tokens: int, tools: Optional[List[Dict[str, Any]]] = None,
             cache: str = "rolling") -> Optional[LLMResponse]:
    """One model call for ``role``. On a transport failure the fallback model (if configured) gets exactly one try.
    ``cache``: "rolling" for the tool loop (every step repeats the whole conversation so far), "system" for a one-shot call."""
    primary = model_for(role)
    response = _send(messages, primary, max_tokens, tools, role, cache)
    if response is not None and response.success:
        return response
    fallback = _fallback_model()
    if fallback and fallback != primary and _transport_failure(response):
        logger.warning(f"Agentic {role} model {primary} failed; trying the fallback {fallback}")
        retry = _send(messages, fallback, max_tokens, tools, role, cache)
        if retry is not None and retry.success:
            return retry
    return response
