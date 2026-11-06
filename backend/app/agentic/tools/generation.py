"""Writing tools: interview questions and LinkedIn posts. They reuse the existing interview and LinkedIn engines (same prompts, same
validation, same "nothing that is not in the job description"), so what Agentic mode writes is checked exactly like the
dedicated chat pages. The writing model is the ``write`` role (models.py).

The finished result goes to the screen as a card; the model only gets a short summary back, so it does not spend tokens
repeating it.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Tuple

from app.agentic import models
from app.agentic.tools.base import Tool, ToolContext, ToolError, ToolOutput, obj, text
from app.agents import usage
from app.agents.base import AgentSpec, parse_answer
from app.agents.interview import INTERVIEW_AGENT
from app.agents.linkedin import LINKEDIN_AGENT
from app.agents.runtime import AgentError, build_messages, prepare_cv

ROLES = frozenset({"admin", "user", "manager", "evp"})
_UUID = re.compile(r"^[0-9a-fA-F-]{32,40}$")


def _job_text(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[str, str]:
    """The job's text and title, from a saved job description or from a job posting."""
    from app.api.routers.agent_chat import _library_jd

    jd_id, job_id = text(args.get("jd_id"), 60), text(args.get("job_id"), 60)
    if jd_id:
        if not _UUID.match(jd_id):
            raise ToolError("That is not a valid job description id. List the job descriptions first.")
        try:
            found = _library_jd(jd_id)
        except AgentError as exc:
            raise ToolError(str(exc))
        return found["text"], found["title"]
    if job_id:
        body = ctx.gateway.get(f"/api/careers/admin/jobs/{job_id}/edit-data")      # applies the person's own access
        parts = [body.get("job_title"), body.get("company_name"), body.get("job_location"), body.get("job_summary"),
                 body.get("key_responsibilities"), body.get("qualifications")]
        return "\n\n".join(str(p) for p in parts if p), text(body.get("job_title"), 120)
    raise ToolError("Say which job: a jd_id (saved job description) or a job_id (job posting).")


def _cv_text(ctx: ToolContext, cv_id: str) -> str:
    from app.api.routers.agent_chat import _library_cv

    if not _UUID.match(cv_id):
        raise ToolError("That is not a valid candidate id. Search for the candidate first.")
    ctx.gateway.get(f"/api/cv/{cv_id}")                                            # access check: same rules as opening the profile
    try:
        return _library_cv(cv_id)["text"]
    except AgentError as exc:
        raise ToolError(str(exc))


def _write(ctx: ToolContext, agent: AgentSpec, args: Dict[str, Any]) -> ToolOutput:
    job_text, title = _job_text(ctx, args)
    if len(job_text.strip()) < 80:
        raise ToolError("That job has too little text to work from.")
    cv = ""
    cv_id = text(args.get("cv_id"), 60)
    if cv_id and agent.accepts_cv:
        cv = prepare_cv(agent, _cv_text(ctx, cv_id))
    request = text(args.get("request"), 400) or agent.default_request
    messages = build_messages(agent, job_text, [], request, cv)
    max_tokens, why_not = usage.plan_call(ctx.session, ctx.username, messages, in_flight=ctx.spent_tokens)
    if why_not:
        raise ToolError(why_not)
    response = models.complete(messages, role="write", max_tokens=max_tokens)
    if response is None or not response.success:
        raise ToolError("The writing model is not available right now. Please try again in a moment.")
    ctx.spent_tokens += int(response.tokens_in or 0) + int(response.tokens_out or 0)
    ctx.spent_cost += float(response.cost_usd or 0.0)
    parsed = parse_answer(agent, (response.data or {}).get("_text", ""), job_text, bool(getattr(response, "truncated", False)))
    if not parsed.in_scope:
        raise ToolError(parsed.refusal)
    meta = dict(parsed.meta)
    if parsed.warnings:
        meta["warnings"] = parsed.warnings
    card = {"type": agent.id, "content": parsed.content, "meta": meta, "job_title": title, "with_cv": bool(cv)}
    return ToolOutput({"status": "written", "kind": agent.id, "job": title,
                       "note": "The full result is already on the person's screen. Do not repeat it; say what it covers and offer a change."},
                      card, f"{agent.name} output written for {title or 'the job'}")


def generate_interview_questions(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    return _write(ctx, INTERVIEW_AGENT, args)


def generate_linkedin_post(ctx: ToolContext, args: Dict[str, Any]) -> ToolOutput:
    return _write(ctx, LINKEDIN_AGENT, args)


_WHICH = {"jd_id": {"type": "string", "description": "A saved job description's id (from list_job_descriptions)."},
          "job_id": {"type": "string", "description": "Or a job posting's id (from list_jobs)."}}

TOOLS = [
    Tool("generate_interview_questions", "Write interview questions for a job. Add cv_id to tailor them to one candidate's CV. "
         "Use request for changes (count, difficulty, topics).",
         obj(**_WHICH, cv_id={"type": "string", "description": "Optional candidate id (from search_candidates)."},
             request={"type": "string", "description": "Optional instruction, e.g. '8 hard technical questions'."}), ROLES, generate_interview_questions, writes=True),
    Tool("generate_linkedin_post", "Write a ready-to-publish LinkedIn post for a job. Use request for tone or length changes.",
         obj(**_WHICH, request={"type": "string", "description": "Optional instruction, e.g. 'shorter and friendlier'."}), ROLES, generate_linkedin_post, writes=True),
]
