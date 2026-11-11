"""Agentic mode: one assistant that can use the application's own features, safely.

How a message is handled (this mirrors the structure used in Al-ain-Rag-Enterprise: guardrails first, a planner that picks
the specialist, specialists that only hold the tools they need, hard limits, and a trace of everything done):

    message
      -> guardrails/   fixed refusals with NO model call: empty, too long, anything that asks to delete or remove, prompt
                       injection, small talk, off-topic. Replies are predefined and offer clickable next steps.
      -> routing/      which specialist handles it: keyword rules first, "sticky" follow-ups next, a tiny router-model
                       call only when the rules are unsure, and a clarifying question when nothing fits.
      -> specialists/  jobs, matching, candidates, interview, linkedin, admin. Each has its own prompt, its own
                       short list of tools and the roles allowed to use it (least privilege).
      -> loop.py       the bounded tool loop: at most AGENTIC_MAX_STEPS model calls and a few tools per step, results cut
                       and sanitised, token budget checked before every call, a stale-step stop.
      -> tools/        every tool talks to the application through its own API, as the signed-in user (tools/gateway.py):
                       only GET and POST, only whitelisted paths, so role checks and row scoping still apply and there is
                       no tool that deletes, removes or edits anything.
      -> orchestrator.py  stitches the above together, applies the write-confirmation rule (a job is only posted after the
                       person confirms the draft they were shown) and saves the turn to the append-only history.

Models are chosen per role (models.py): router, act, write, fallback. Each is one OpenRouter model id in the settings.
"""
