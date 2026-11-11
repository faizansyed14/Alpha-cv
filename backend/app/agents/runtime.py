"""One turn of an agent conversation, start to finish.

    1  resolve the job description (library / pasted / uploaded) and the conversation (new, or the person's own)
    2  gate        fixed refusals for small talk, off-topic, other-agent requests, injection, oversized input: NO model call
    3  budget      the person's daily TOKEN budget and the global ceiling, checked on an estimate BEFORE the call (usage.py)
    4  prompt      system prompt + the job text in a delimited, sanitised block + the last few answered turns + the request
    5  ONE call    OpenRouter (Claude Haiku), through the shared LLM client (retries, timeouts, usage and cost recorded)
    6  validate    the answer must have the agent's shape; "in_scope: false" becomes a refusal; ungrounded figures are flagged
    7  record      the question and the answer are appended to the history (never updated, never deleted)

The agent has no tools that write anything and cannot reach other data: it sees only the one job description it was given.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from sqlmodel import Session

from app.agents import store, usage
from app.agents.scope import MAX_MESSAGE_CHARS, check_message
from app.agents.base import OutputRejected, parse_answer
from app.agents.registry import get_agent
from app.config.settings import settings
from app.providers.llm.service import get_llm_service
from app.security.llm_guard import injection_flags, mask_pii, sanitize_untrusted

logger = logging.getLogger(__name__)

MIN_JD_CHARS = 80


class AgentError(Exception):
    """A request that cannot be handled; ``status`` and the message are safe to return to the caller."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class TurnResult:
    conversation: Any
    user_message: Any
    assistant_message: Any


@dataclass
class Refusal:
    """A message refused before any conversation existed: the fixed reply is returned, nothing is stored."""
    reason: str
    reply: str
    suggestions: Optional[List[str]] = None


def _title_from(jd_title: Optional[str], jd_text: str) -> str:
    if jd_title and jd_title.strip() and jd_title != "Not specified":
        return jd_title.strip()
    first = next((ln.strip() for ln in jd_text.splitlines() if len(ln.strip()) > 3), "Job description")
    return first[:80]


def prepare_cv(agent, cv_text: Optional[str]) -> str:
    """The candidate CV as it is stored and sent: only for agents that use one, sanitised, contact details masked, capped."""
    if not agent.accepts_cv or not (cv_text or "").strip():
        return ""
    return mask_pii(sanitize_untrusted(cv_text, settings.AGENT_MAX_CV_CHARS)).strip()


def build_messages(agent, jd_text: str, history: List[Any], request: str, cv_text: str = "") -> List[Dict[str, str]]:
    """System prompt, the job text (and CV, if any) in their own blocks, the last answered turns, then the new request."""
    jd_block = f"<job_description>\n{sanitize_untrusted(jd_text, settings.AGENT_MAX_JD_CHARS)}\n</job_description>"
    intro = "Here is the job description for this whole conversation:\n" + jd_block
    system = agent.system_prompt
    if cv_text:
        intro += "\n\nHere is the candidate's CV:\n<candidate_cv>\n" + cv_text + "\n</candidate_cv>"
        system = system + "\n" + agent.cv_rules
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": intro},
        {"role": "assistant", "content": "Understood."},
    ]
    for m in history:
        messages.append({"role": m.role, "content": m.content[:8000]})
    messages.append({"role": "user", "content": sanitize_untrusted(request, MAX_MESSAGE_CHARS)})
    return messages


def _call_model(agent, messages: List[Dict[str, str]], max_tokens: int):
    return get_llm_service()._call_openai_api(
        messages=messages, max_tokens=max_tokens, json_schema=None, raw=True,
        timeout=settings.AGENT_TIMEOUT_SECONDS, role=f"agent_{agent.id}", detail={"agent": agent.id}, cache="rolling")


def handle_turn(session: Session, *, agent_id: str, username: str, message: str, conversation_id: Optional[str],
                jd_text: Optional[str], jd_id: Optional[str], jd_title: Optional[str], jd_source: str,
                cv_text: Optional[str] = None, cv_id: Optional[str] = None, cv_title: Optional[str] = None):
    """Run one turn: a TurnResult, or a Refusal when the message was refused before any conversation existed."""
    agent = get_agent(agent_id)
    if agent is None:
        raise AgentError("Unknown agent.", 404)
    message = (message or "").strip()

    # ---- 1. the conversation
    conv = None
    if conversation_id:
        conv = store.get_conversation(session, conversation_id, username)
        if conv is None or conv.agent != agent.id:
            raise AgentError("Conversation not found.", 404)
    has_answer = bool(conv and store.recent_exchange(session, conv.id, 1))

    # ---- 2. the gate (fixed replies, no model call)
    decision = check_message(agent, message, has_answer)
    if decision.allowed and conv is None:
        text = sanitize_untrusted(jd_text or "", settings.AGENT_MAX_JD_CHARS).strip()
        if not text:
            decision = type(decision)(False, "no_jd", "Choose a job description first: pick one from the list, paste it, or upload a file.")
        elif len(text) < MIN_JD_CHARS:
            decision = type(decision)(False, "jd_too_short", "That job description is too short to work from. Paste or upload the full text.")

    def refuse(reason: str, reply: str):
        if conv is None:
            return Refusal(reason, reply)                 # nothing was started, so there is nothing to record
        u = store.append_message(session, conv.id, "user", message[:MAX_MESSAGE_CHARS * 2], status="blocked", blocked_reason=reason)
        a = store.append_message(session, conv.id, "assistant", reply, status="blocked", blocked_reason=reason)
        return TurnResult(conv, u, a)

    if not decision.allowed:
        return refuse(decision.reason, decision.reply)
    if injection_flags(jd_text or "") and conv is None:
        logger.warning(f"Agent {agent.id}: job description from {username} contains instruction-like text (sanitised, not obeyed)")

    # ---- 3. budget: nothing is written and no call is made unless this person has tokens left for it
    if not usage.begin_request(username):
        raise AgentError("Your previous request is still being answered. Please wait for it to finish.", 429)
    try:
        return _answer(session, agent, username, message, conv, jd_text, jd_id, jd_title, jd_source, cv_text, cv_id, cv_title)
    finally:
        usage.end_request(username)


def _answer(session, agent, username, message, conv, jd_text, jd_id, jd_title, jd_source, cv_text=None, cv_id=None, cv_title=None):
    # ---- 4. prompt (history is the last answered turn only: every earlier turn would be paid for again)
    job_text = conv.jd_text if conv is not None else sanitize_untrusted(jd_text or "", settings.AGENT_MAX_JD_CHARS).strip()
    history = store.recent_exchange(session, conv.id, settings.AGENT_HISTORY_TURNS) if conv is not None else []
    cv = (conv.cv_text or "") if conv is not None else prepare_cv(agent, cv_text)
    messages = build_messages(agent, job_text, history, message, cv)
    max_tokens, why_not = usage.plan_call(session, username, messages)
    if why_not:
        raise AgentError(why_not, 429)

    # ---- the conversation is created only now: a real request for a real job description, inside the budget
    if conv is None:
        conv = store.create_conversation(session, agent=agent.id, username=username, title=_title_from(jd_title, job_text),
                                         jd_text=job_text, jd_source=jd_source, jd_id=jd_id, jd_title=jd_title,
                                         cv_text=cv, cv_id=cv_id, cv_title=cv_title)
    user_row = store.append_message(session, conv.id, "user", message[:MAX_MESSAGE_CHARS * 2])

    # ---- 5. the one model call
    started = time.perf_counter()
    try:
        response = _call_model(agent, messages, max_tokens)
    except Exception as exc:  # noqa: BLE001 - a missing key or a transport failure must not leak details to the user
        logger.error(f"Agent {agent.id} call failed to start: {mask_pii(str(exc))[:300]}")
        response = None
    latency = int((time.perf_counter() - started) * 1000)

    def record_error(reason: str, reply: str) -> TurnResult:
        # a call that was answered but unusable still cost tokens, so they are counted
        a = store.append_message(session, conv.id, "assistant", reply, status="error", blocked_reason=reason, latency_ms=latency,
                                 model=getattr(response, "model_used", None), tokens_in=int(getattr(response, "tokens_in", 0) or 0),
                                 tokens_out=int(getattr(response, "tokens_out", 0) or 0), cost_usd=getattr(response, "cost_usd", None))
        return TurnResult(conv, user_row, a)

    if response is None or not response.success:
        logger.error(f"Agent {agent.id} model error: {mask_pii(getattr(response, 'error_message', '') or 'no response')[:300]}")
        return record_error("model_error", "The AI service is not available right now. Please try again in a moment.")

    # ---- 6. validate
    try:
        parsed = parse_answer(agent, (response.data or {}).get("_text", ""), conv.jd_text, bool(getattr(response, "truncated", False)))
    except OutputRejected as exc:
        logger.warning(f"Agent {agent.id} answer rejected: {exc}")
        return record_error("bad_output", "I couldn't produce a usable answer this time. Please try again, or rephrase the request.")

    spent = dict(model=response.model_used, tokens_in=response.tokens_in, tokens_out=response.tokens_out,
                 cost_usd=response.cost_usd, latency_ms=latency)
    if not parsed.in_scope:
        a = store.append_message(session, conv.id, "assistant", parsed.refusal, status="blocked", blocked_reason="off_topic_model", **spent)
        return TurnResult(conv, user_row, a)

    meta = dict(parsed.meta)
    if parsed.warnings:
        meta["warnings"] = parsed.warnings
    a = store.append_message(session, conv.id, "assistant", parsed.content, status="ok", meta=meta, **spent)
    return TurnResult(conv, user_row, a)
