"""One turn of Agentic mode, start to finish.

    1  conversation   the person's own chat (or a new one), previous specialist, any job draft waiting for confirmation
    2  guardrails     fixed replies, NO model: empty, too long, delete/remove, injection, small talk, off-topic
    3  one at a time  one running request per person; budget checked before anything is spent
    4  routing        rules -> sticky -> router model -> ask (routing/router.py)
    4b answers        a waiting change (a card with Confirm / Cancel) is answered here, in code, without a model (actions/flow.py)
    5  specialist     its prompt and ONLY its tools for this role; write-confirmation computed here, in code
    6  tool loop      bounded, budgeted, sanitised (loop.py)
    7  save           the question, the answer, the cards, the trace and the tokens, in the append-only history

Everything shown as a card was produced by a tool from application data. The model's prose is cleaned (no ids) and capped.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from sqlmodel import Session

from app.agentic import loop, uploads
from app.agentic.actions import flow as action_flow
from app.agentic.guardrails import confirmation, input_guard
from app.agentic.guardrails.output_guard import clean_answer, safe_text
from app.agentic.routing import intents, router
from app.agentic.specialists import registry as specialists
from app.agentic.tools import candidates as candidate_tools
from app.agentic.tools import jobs as job_tools
from app.agentic.tools import matching as match_tools
from app.agentic.tools.base import ToolContext, ToolError, ToolOutput
from app.agentic.tools.gateway import ApiGateway
from app.agents import store, usage
from app.agents.runtime import AgentError, Refusal, TurnResult
from app.config.settings import settings

logger = logging.getLogger(__name__)

AGENT_ID = "assistant"          # the value stored in agent_conversation.agent for Agentic mode


@dataclass
class Principal:
    """Who is asking. ``token`` is the person's own bearer token: tools call the app as them, so their role limits apply."""
    username: str
    role: str
    token: str
    client_ip: Optional[str] = None


def _last_assistant(rows: List[Any]) -> Optional[Any]:
    return next((m for m in reversed(rows) if m.role == "assistant"), None)


def _pending_draft(rows: List[Any]) -> Optional[Dict[str, Any]]:
    """The job draft still waiting for the person's answer.

    It stays pending through questions and refusals (a "yes" must not be lost because a message in between was a question), and
    ends when the job is posted, the person cancels, or the conversation moves on to another skill.
    """
    for m in reversed(rows):
        if m.role != "assistant" or m.status != "ok":
            continue
        meta = m.meta or {}
        if meta.get("specialist") != "jobs" or meta.get("cancelled"):
            return None
        cards = meta.get("cards") or []
        if any(c.get("type") == "job_posted" for c in cards):
            return None
        for card in cards:
            if card.get("type") == "job_draft":
                fields = dict(card.get("fields") or {})
                if card.get("attachment"):
                    fields["_attachment"] = card["attachment"]
                return fields
    return None


def _job_flow_started(rows: List[Any]) -> bool:
    return any(c.get("type") in ("job_draft", "job_posted") for m in rows if m.role == "assistant" for c in ((m.meta or {}).get("cards") or []))


def _history(rows: List[Any]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for m in rows[-settings.AGENTIC_HISTORY_MESSAGES:]:
        if m.status != "ok":
            continue
        if m.role == "user":
            out.append({"role": "user", "content": safe_text(m.content, 700)})
        else:
            out.append({"role": "assistant", "content": ((m.meta or {}).get("context") or m.content)[:1600]})
    return out


def _chips(cards: List[Dict[str, Any]]) -> List[str]:
    kinds = {c.get("type") for c in cards}
    # job drafts and posted jobs carry their own buttons on the card, so no chips are repeated under them
    if "interview" in kinds:
        return ["Make it harder", "Only behavioural questions"]
    if "linkedin" in kinds:
        return ["Make it shorter", "A friendlier tone"]
    return []


def _store_refusal(session: Session, conv: Any, message: str, reason: str, reply: str, chips: List[str]):
    meta = {"suggestions": chips} if chips else None
    user_row = store.append_message(session, conv.id, "user", message[:4000], status="blocked", blocked_reason=reason)
    assistant_row = store.append_message(session, conv.id, "assistant", reply, status="blocked", blocked_reason=reason, meta=meta)
    return TurnResult(conv, user_row, assistant_row)


def handle_turn(session: Session, *, user: Principal, message: str, conversation_id: Optional[str], attachment_ref: Optional[str] = None,
                selection: Optional[Dict[str, Any]] = None):
    if not settings.AGENTIC_ENABLED:
        raise AgentError("Agentic mode is switched off.", 404)
    message = (message or "").strip()
    staged = None
    if attachment_ref:
        staged = uploads.load(user.username, attachment_ref)
        if staged is None:
            raise AgentError("That upload has expired. Please upload the file again.", 400)
        message = message or "Post this job from the attached file."
    conv = None
    rows: List[Any] = []
    if conversation_id:
        conv = store.get_conversation(session, conversation_id, user.username)
        if conv is None or conv.agent != AGENT_ID:
            raise AgentError("Conversation not found.", 404)
        rows = store.messages(session, conv.id)
    last = _last_assistant(rows)
    draft = _pending_draft(rows)
    fresh = staged is not None                      # attached with THIS message
    carried_jd = None
    if staged is None and draft is None and last is not None and last.status == "ok":
        carried = (last.meta or {}).get("attachment")      # an earlier file that has not been posted yet stays available
        if carried:
            staged = uploads.load(user.username, str(carried.get("ref", "")))
            carried_jd = carried.get("jd_id")
    previous = (last.meta or {}).get("specialist") if last is not None and last.status == "ok" else None
    allowed = specialists.available(user.role)
    examples = specialists.examples_for(user.role)
    if not allowed:
        raise AgentError("Agentic mode is not available for your role.", 403)

    # ---- 2. guardrails: no model call
    verdict = input_guard.inspect(message, role=user.role, examples=examples, pending_draft=draft is not None or action_flow.pending(rows) is not None)
    if not verdict.ok:
        if conv is None:
            return Refusal(verdict.kind, verdict.reply, verdict.suggestions or None)
        return _store_refusal(session, conv, message, verdict.kind, verdict.reply, verdict.suggestions)

    # ---- 2b. asking for a skill the role does not have: say so (the tools would be refused anyway), no model call
    wanted = sorted(intents.score(message).items(), key=lambda kv: -kv[1])
    if wanted and wanted[0][1] >= 3 and wanted[0][0] not in {s.name for s in allowed} and draft is None:
        reply = "That isn't available for your role. Here is what you can ask me:"
        if conv is None:
            return Refusal("role", reply, examples[:4])
        return _store_refusal(session, conv, message, "role", reply, examples[:4])

    # ---- 3. one at a time, and something left to spend
    if not usage.begin_request(user.username):
        raise AgentError("Your previous request is still being answered. Please wait for it to finish.", 429)
    try:
        return _answer(session, user, message, conv, rows, draft, previous, allowed, examples, staged, fresh, carried_jd, selection)
    finally:
        usage.end_request(user.username)


_PURPOSE = {"matching": "match", "interview": "interview", "linkedin": "linkedin"}      # what a list is being looked at FOR
_LIST_CARDS = ("job_descriptions", "jobs", "candidates")
_RECHECK = re.compile(r"\b(?:check|progress|status|again|results?|still|ready)\b", re.I)
_NAMED_JOB = re.compile(r"\b(?:for|against|on)\s+(?:the\s+)?[\w.#/&+ -]{3,60}?\s+(?:job|role|jd|position|description|opening)\b", re.I)
_MENTIONS_PICKS = re.compile(r"\busing\b|\bcategor|\bnewest\b", re.I)


def _wants_match_setup(message: str) -> bool:
    """A plain "match CVs" with no job named and no picks yet: answer with the setup card (no model needed)."""
    return (intents.score(message).get("matching", 0) >= 3 and not _RECHECK.search(message) and not _NAMED_JOB.search(message)
            and not _MENTIONS_PICKS.search(message))


def _skills_note(allowed: List[Any], current: str) -> str:
    others = [f"{s.name} ({s.description})" for s in allowed if s.name != current]
    return ("\n\nYour other skills, which you can hand a request to with switch_skill: " + "; ".join(others) + ".") if others else ""


def _build(session: Session, user: Principal, spec: Any, message: str, rows: List[Any], draft: Optional[Dict[str, Any]], staged: Optional[Any],
           carried_jd: Optional[str], allowed: List[Any], hint: str = ""):
    """The tools, the context and the messages for one skill. ``hint`` is extra context for the model only (an exact candidate id); it is
    added after the person's text is cleaned, so an id is never altered by the privacy masking."""
    tools = specialists.tools_of(spec, user.role)
    confirmed = draft is not None and spec.name == "jobs" and confirmation.is_confirmation(message)
    ctx = ToolContext(session=session, gateway=ApiGateway(user.token, user.client_ip), username=user.username, role=user.role, message=message,
                      pending_draft=draft if spec.name == "jobs" else None, confirmed=confirmed, show_lists=intents.wants_list(message),
                      specialist=spec.name, allowed_skills=[s.name for s in allowed if s.name != spec.name],
                      attachment={"ref": staged.ref, "filename": staged.filename, "jd_id": carried_jd} if (staged is not None and spec.name in ("jobs", "candidates")) else None)
    system = spec.system_prompt(user.username, user.role) + _skills_note(allowed, spec.name)
    if ctx.pending_draft:
        system += (f"\n\nA draft job post titled \"{ctx.pending_draft.get('job_title', '')}\" is on the person's screen waiting for their answer. "
                   + ("They have JUST CONFIRMED it: call publish_job_post now." if confirmed else
                      "If they ask for changes, call draft_job_post again with the full updated draft. Do not publish."))
    if ctx.attachment and spec.name == "candidates":
        system += (f"\n\nThe person attached the file \"{safe_text(ctx.attachment['filename'], 120)}\". If it is a CV they want saved to the library, call propose_cv_upload.")
    elif ctx.attachment and not ctx.attachment.get("jd_id"):
        system += (f"\n\nThe person attached the job description file \"{safe_text(ctx.attachment['filename'], 120)}\". It has not been read yet: call read_job_file. "
                   "(If they only want it saved to the job descriptions library and NOT posted, call propose_jd_upload instead.)")
    if ctx.pending_draft:
        needs = [k for k in ("job_title", "job_location") if not str(ctx.pending_draft.get(k) or "").strip()]
        if needs:
            system += f"\n\nThe draft on screen is still missing: {', '.join(n.replace('job_', '') for n in needs)}. Ask for it, or use it if the person just gave it (call draft_job_post with only that)."
    messages = [{"role": "system", "content": system}, *_history(rows), {"role": "user", "content": safe_text(message, 4000) + hint}]
    return tools, ctx, messages


def _run(session: Session, spec: Any, tools: List[Any], ctx: ToolContext, messages: List[Dict[str, Any]], user: Principal, already: int = 0):
    try:
        return loop.run(session, spec, tools, ctx, messages, already_spent=already)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Agentic loop crashed for {user.username}: {str(exc)[:200]}", exc_info=True)
        return loop.LoopResult(failed=True)


def _answer(session: Session, user: Principal, message: str, conv: Any, rows: List[Any], draft: Optional[Dict[str, Any]],
            previous: Optional[str], allowed: List[Any], examples: List[str], staged: Optional[Any] = None, fresh: bool = False,
            carried_jd: Optional[str] = None, selection: Optional[Dict[str, Any]] = None):
    answered = _answer_waiting_change(session, user, message, conv, rows, selection)
    if answered is not None:
        return answered                                       # Confirm / Cancel on a proposed change: done here in code, nothing is spent
    if draft is not None and conv is not None and confirmation.is_cancellation(message):
        return _cancel_draft(session, conv, message)          # "no" / "cancel": answered here, nothing is spent
    _, why_not = usage.plan_call(session, user.username, [{"content": message}])
    if why_not:
        raise AgentError(why_not, 429)

    # ---- 4. routing
    sel_kind = (selection or {}).get("kind") if isinstance(selection, dict) else None
    if sel_kind == "review" and any(s.name == "candidates" for s in allowed):
        chosen = router.Route("candidates", "selection")                  # the Review button on one exact candidate
    elif selection is not None and sel_kind != "focus" and any(s.name == "matching" for s in allowed):
        chosen = router.Route("matching", "selection")                    # the person picked on the setup card
    elif staged is not None and fresh and _CV_FILE.search(message) and any(s.name == "candidates" for s in allowed):
        chosen = router.Route("candidates", "attachment")                 # a CV file: add it to the library
    elif staged is not None and fresh and any(s.name == "jobs" for s in allowed):
        chosen = router.Route("jobs", "attachment")                       # a job description file is for posting a job
    else:
        chosen = router.route(message, allowed=allowed, previous=previous, pending_draft=draft is not None)
    started = time.perf_counter()
    if conv is None:
        conv = store.create_conversation(session, agent=AGENT_ID, username=user.username, title=safe_text(message, 70) or "New chat",
                                         jd_text="", jd_source="assistant", jd_id=None, jd_title=None)
    if chosen.specialist is None:
        ask = ("I'm not sure which of my skills you need. Pick one, or tell me a bit more:")
        user_row = store.append_message(session, conv.id, "user", message[:4000])
        assistant_row = store.append_message(session, conv.id, "assistant", ask, status="blocked", blocked_reason="clarify",
                                             meta={"suggestions": examples[:5]}, tokens_in=chosen.tokens, cost_usd=chosen.cost or None)
        return TurnResult(conv, user_row, assistant_row)
    user_row = store.append_message(session, conv.id, "user", message[:4000],
                                    meta={"attachment": {"filename": staged.filename}} if (staged is not None and fresh) else None)

    # ---- 5. deterministic turns: no model is needed for these
    if chosen.how == "selection":
        return _run_selection(session, user, conv, user_row, message, selection or {}, allowed)
    if chosen.specialist == "matching" and selection is None and _wants_match_setup(message):
        done = _match_setup_turn(session, user, conv, user_row, allowed)
        if done is not None:
            return done

    # ---- 6. the skill and its tool loop (with at most one hand-over to another skill)
    spec = specialists.get(chosen.specialist)
    hint = _focus_hint(selection)                                               # the exact candidate a button meant (not saved in the chat)
    tools, ctx, messages = _build(session, user, spec, message, rows, draft, staged, carried_jd, allowed, hint)
    if ctx.confirmed:
        return _post_confirmed(session, conv, user_row, ctx, chosen)      # the person said yes: post it now, in code, no model involved
    result = _run(session, spec, tools, ctx, messages, user)
    spent_tools = ctx.spent_tokens
    spent_cost = ctx.spent_cost
    how = chosen.how
    if result.handoff and any(s.name == result.handoff for s in allowed):
        first = result
        spec = specialists.get(result.handoff)
        tools, ctx, messages = _build(session, user, spec, message, rows, draft, staged, carried_jd, allowed, hint)
        ctx.spent_tokens, ctx.spent_cost = spent_tools, spent_cost            # what the first pass's tools used still counts
        result = _run(session, spec, tools, ctx, messages, user, already=first.tokens_in + first.tokens_out)
        result.tokens_in += first.tokens_in
        result.tokens_out += first.tokens_out
        result.cost += first.cost
        result.trace = first.trace + result.trace
        result.cards = first.cards + result.cards
        result.memos = first.memos + result.memos
        how = "handoff"
        logger.info(f"agentic hand-over user={user.username} {chosen.specialist} -> {spec.name}")
    latency = int((time.perf_counter() - started) * 1000)
    tokens_in = result.tokens_in + ctx.spent_tokens + chosen.tokens
    cost = (result.cost + ctx.spent_cost + chosen.cost) or None
    names = [t["tool"] for t in result.trace]
    logger.info(f"agentic turn user={user.username} role={user.role} specialist={spec.name} route={how} tools={names} "
                f"steps={result.steps} tokens={tokens_in + result.tokens_out} ok={not result.failed}")

    # ---- 7. save
    if result.failed and not result.cards:
        reply = "The AI service is not available right now. Please try again in a moment."
        assistant_row = store.append_message(session, conv.id, "assistant", reply, status="error", blocked_reason="model_error", latency_ms=latency,
                                             model=result.model, tokens_in=tokens_in, tokens_out=result.tokens_out, cost_usd=cost)
        return TurnResult(conv, user_row, assistant_row)
    text = clean_answer(result.text) if result.text else ""
    if result.limit_message:
        text = (text + "\n\n" if text else "") + result.limit_message
    if not text:
        text = "Here is what I found." if result.cards else "I couldn't put together an answer this time. Please try again or rephrase."
    cards = list(result.cards)
    purpose = _PURPOSE.get(spec.name)
    for card in cards:
        if card.get("type") in _LIST_CARDS and purpose:
            card["purpose"] = purpose                                          # rows become choices for this task (Match / Interview / Post)
    if spec.name == "jobs" and not cards and ctx.attachment is None and not _job_flow_started(rows):
        cards.append({"type": "upload_prompt", "for": "job_description"})      # offer the upload box instead of only asking for text
    meta = {"specialist": spec.name, "route": how, "cards": cards, "trace": result.trace,
            "context": (text + ("\n[Earlier results: " + " | ".join(result.memos) + "]" if result.memos else ""))[:2400],
            "suggestions": _chips(cards) or (result.choices[:6] if (result.choices and not cards and text.rstrip().endswith("?")) else [])}
    if ctx.attachment and not ctx.published and spec.name == "jobs":
        meta["attachment"] = {k: ctx.attachment[k] for k in ("ref", "filename", "jd_id") if ctx.attachment.get(k)}      # still waiting to be posted
    assistant_row = store.append_message(session, conv.id, "assistant", text, status="ok", meta=meta, latency_ms=latency, model=result.model,
                                         tokens_in=tokens_in, tokens_out=result.tokens_out, cost_usd=cost)
    return TurnResult(conv, user_row, assistant_row)


def _match_setup_turn(session: Session, user: Principal, conv: Any, user_row: Any, allowed: List[Any]):
    """"I want to match": one card with the job descriptions, the CV categories with counts and the count box. No model, no tokens."""
    started = time.perf_counter()
    try:
        card = match_tools.match_setup_card(ApiGateway(user.token, user.client_ip))
    except ToolError:
        return None                                                         # the data could not be read: let the model deal with it
    text = f"Choose the job description, the CV categories and how many CVs to match (at most {match_tools.match_cap():,}), then press Match."
    meta = {"specialist": "matching", "route": "setup", "cards": [card], "trace": [], "context": text, "suggestions": []}
    row = store.append_message(session, conv.id, "assistant", text, status="ok", meta=meta, latency_ms=int((time.perf_counter() - started) * 1000))
    return TurnResult(conv, user_row, row)


def _run_selection(session: Session, user: Principal, conv: Any, user_row: Any, message: str, selection: Dict[str, Any], allowed: List[Any]):
    """The picks from the setup card, run straight through run_matching (same limits and engine). No model, no tokens."""
    started = time.perf_counter()
    if selection.get("kind") == "review":
        return _run_review(session, user, conv, user_row, message, selection)
    ctx = ToolContext(session=session, gateway=ApiGateway(user.token, user.client_ip), username=user.username, role=user.role, message=message, specialist="matching")
    try:
        if selection.get("kind") != "match":
            raise ToolError("That selection is not something I can run.")
        out = match_tools.run_selection(ctx, selection)
    except ToolError as exc:
        out = ToolOutput({"error": str(exc)}, ok=False)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Agentic selection crashed for {user.username}: {str(exc)[:200]}", exc_info=True)
        out = ToolOutput({"error": "The matching could not be started."}, ok=False)
    ms = int((time.perf_counter() - started) * 1000)
    scope = (out.card or {}).get("scope") or {}
    title = text_of(selection.get("jd_title")) or "the job description"
    if out.ok and (out.card or {}).get("type") == "matches":
        text = f"Scored {int(scope.get('cvs_scored', 0)):,} CVs against {title}. The best matches are on screen."
    elif out.ok:
        text = f"Matching {int(scope.get('cvs_scored', 0)):,} CVs against {title} has started. The results will appear below as soon as they are ready."
    else:
        text = f"I couldn't start the match: {out.data.get('error', 'something went wrong')}"
    cards = [out.card] if out.card else []
    meta = {"specialist": "matching", "route": "selection", "cards": cards,
            "trace": [{"step": 1, "tool": "run_matching", "ok": out.ok, "ms": ms, "args": {}}], "context": text + (f"\n[Earlier results: {out.memo}]" if out.memo else ""),
            "suggestions": []}
    row = store.append_message(session, conv.id, "assistant", text, status="ok", meta=meta, latency_ms=ms)
    logger.info(f"agentic turn user={user.username} role={user.role} specialist=matching route=selection ok={out.ok}")
    return TurnResult(conv, user_row, row)


_CV_FILE = re.compile(r"\b(?:cv|resume|r\u00e9sum\u00e9|curriculum)\b", re.I)
_CV_ID = re.compile(r"^[0-9a-fA-F-]{32,40}$")
_JOB_ID = re.compile(r"^[\w-]{8,64}$")


def _focus_hint(selection: Optional[Dict[str, Any]]) -> str:
    """A button on one exact candidate or job (Interview questions, Add a note, Close, Edit) carries that record's id. The model is told
    which one is meant, so two records with the same name can never be mixed up. The id is checked here; the chat shows only the text."""
    if not isinstance(selection, dict) or selection.get("kind") != "focus":
        return ""
    name = safe_text(selection.get("name"), 80)
    if _CV_ID.match(str(selection.get("cv_id") or "")):
        return f"\n(The person means this exact candidate: {name}, cv_id={selection['cv_id']}. Use that cv_id; do not search for the name.)"
    if _JOB_ID.match(str(selection.get("job_id") or "")):
        return f"\n(The person means this exact job posting: {name}, job_id={selection['job_id']}. Use that job_id; do not look the job up by title.)"
    return ""


def _run_review(session: Session, user: Principal, conv: Any, user_row: Any, message: str, selection: Dict[str, Any]):
    """The Review button of one exact candidate: read THAT profile (by id) and show it. No model, no tokens."""
    started = time.perf_counter()
    cv_id = str(selection.get("cv_id") or "")
    ctx = ToolContext(session=session, gateway=ApiGateway(user.token, user.client_ip), username=user.username, role=user.role, message=message, specialist="candidates")
    try:
        if not _CV_ID.match(cv_id):
            raise ToolError("That candidate could not be identified.")
        out = candidate_tools.get_candidate(ctx, {"cv_id": cv_id})
    except ToolError as exc:
        out = ToolOutput({"error": str(exc)}, ok=False)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Agentic review crashed for {user.username}: {str(exc)[:200]}", exc_info=True)
        out = ToolOutput({"error": "The profile could not be opened."}, ok=False)
    ms = int((time.perf_counter() - started) * 1000)
    name = safe_text((out.card or {}).get("name"), 80)
    text = f"Here is the profile of {name}." if out.ok and name else (f"I couldn't open that profile: {out.data.get('error', 'something went wrong')}" if not out.ok else "Here is the profile.")
    cards = [out.card] if out.card else []
    meta = {"specialist": "candidates", "route": "selection", "cards": cards, "trace": [{"step": 1, "tool": "get_candidate", "ok": out.ok, "ms": ms, "args": {}}],
            "context": text + (f"\n[Earlier results: {out.memo}]" if out.memo else ""), "suggestions": []}
    row = store.append_message(session, conv.id, "assistant", text, status="ok", meta=meta, latency_ms=ms)
    logger.info(f"agentic turn user={user.username} role={user.role} specialist=candidates route=review ok={out.ok}")
    return TurnResult(conv, user_row, row)


def _answer_waiting_change(session: Session, user: Principal, message: str, conv: Any, rows: List[Any], selection: Optional[Dict[str, Any]]):
    """A change is waiting on screen (Confirm / Cancel): the button or a plain yes / no answers it, in code. Only the proposal saved in
    THIS conversation, and only while it is the latest message, can be confirmed: the browser sends no details, only which button."""
    kind = (selection or {}).get("kind") if isinstance(selection, dict) else None
    if conv is None:
        return None
    card = action_flow.pending(rows)
    pressed = kind in ("confirm", "cancel_action")
    if pressed and (card is None or selection.get("action_id") != card.get("id")):
        user_row = store.append_message(session, conv.id, "user", message[:4000])
        reply = "That change isn't waiting any more. Tell me again what you'd like and I'll set it up."
        row = store.append_message(session, conv.id, "assistant", reply, status="ok", meta={"route": "stale_action", "cards": [], "context": reply, "suggestions": []})
        return TurnResult(conv, user_row, row)
    if card is None:
        return None
    if kind == "confirm" or (not pressed and selection is None and confirmation.is_confirmation(message)):
        return action_flow.confirm(session, user, ApiGateway(user.token, user.client_ip), conv, store.append_message(session, conv.id, "user", message[:4000]), card)
    if kind == "cancel_action" or (not pressed and selection is None and confirmation.is_cancellation(message)):
        return action_flow.cancel(session, conv, store.append_message(session, conv.id, "user", message[:4000]), card)
    return None


def text_of(value: Any) -> str:
    return safe_text(value, 120)


def _cancel_draft(session: Session, conv: Any, message: str):
    user_row = store.append_message(session, conv.id, "user", message[:4000])
    text = "Okay, I won't post it. Tell me what to change, or ask me for something else."
    row = store.append_message(session, conv.id, "assistant", text, status="ok",
                               meta={"specialist": "jobs", "route": "cancel", "cancelled": True, "cards": [], "context": text,
                                     "suggestions": ["Change the location", "Start a new job"]})
    return TurnResult(conv, user_row, row)


def _post_confirmed(session: Session, conv: Any, user_row: Any, ctx: ToolContext, chosen: Any):
    """The person confirmed the draft on screen (verified in code), so it is posted by the tool directly. No model call: posting is a
    fixed step, and the answer is a fixed sentence built from what the application returned."""
    started = time.perf_counter()
    try:
        out = job_tools.publish_job_post(ctx, {})
    except ToolError as exc:
        out = ToolOutput({"error": str(exc)}, ok=False)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Agentic posting crashed for {ctx.username}: {str(exc)[:200]}", exc_info=True)
        out = ToolOutput({"error": "The application did not accept the job."}, ok=False)
    ms = int((time.perf_counter() - started) * 1000)
    if out.ok and out.card:
        title, subject = out.card.get("title") or "The job", out.card.get("subject")
        text = f"Done. {title} is posted and live on the careers page." + (f" Its unique subject line is {subject}." if subject else "")
        cards = [out.card]
    else:
        text = f"I couldn't post it: {out.data.get('error', 'something went wrong')} Your draft is still here, so say yes to try again."
        cards = []
    logger.info(f"agentic turn user={ctx.username} role={ctx.role} specialist=jobs route=confirm posted={out.ok}")
    meta = {"specialist": "jobs", "route": "confirm", "cards": cards, "trace": [{"step": 1, "tool": "publish_job_post", "ok": out.ok, "ms": ms, "args": {}}],
            "context": text + (f"\n[Earlier results: {out.memo}]" if out.memo else ""), "suggestions": _chips(cards)}
    row = store.append_message(session, conv.id, "assistant", text, status="ok", meta=meta, latency_ms=ms)
    return TurnResult(conv, user_row, row)
