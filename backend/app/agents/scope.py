"""The gate in front of every agent: decides, WITHOUT calling the model, whether a message is something this agent does.

Off-topic requests, requests for the other agent's job, instruction-override attempts, empty or oversized messages, and very short
messages that name no task at all (a lone "hi") are answered here with a fixed refusal. They cost nothing and never reach the model.
Anything that passes is still told to refuse off-topic requests by the agent's own prompt (prompt.py in the agent's package), so the
gate does not have to be perfect.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.security.llm_guard import injection_flags

MAX_MESSAGE_CHARS = 1500

_OFF_TOPIC = re.compile(
    r"\b(?:weather|temperature\s+in|joke|poem|poetry|song|lyrics|recipe|horoscope|astrology|bitcoin|crypto|stock\s+price|"
    r"football|cricket|soccer|movie|film|netflix|translate|translation|solve|equation|calculate|math(?:s)?\s+problem|"
    r"capital\s+of|president\s+of|prime\s+minister|who\s+won|who\s+is\s+the|news|trivia|homework|essay|story|riddle|"
    r"tell\s+me\s+about\s+yourself|your\s+favou?rite|meaning\s+of\s+life|chatgpt|openai|gemini)\b"
    r"|\b(?:write|generate|create|give|make|build|debug|fix|refactor)\b.{0,30}\b(?:code|script|program|function|sql|query|regex|"
    r"html|css|python|javascript|typescript|java|c\+\+|app|website|bot)\b", re.I)

@dataclass
class Decision:
    allowed: bool
    reason: str = ""            # empty | too_long | off_topic | wrong_agent | injection | no_jd | jd_too_short
    reply: str = ""             # what the user is told (fixed text, never from the model)


def _blocked(reason: str, reply: str) -> Decision:
    return Decision(False, reason, reply)


def _capabilities(agent_name: str, examples: list[str]) -> str:
    sample = " ".join(f'"{e}"' for e in examples[:3])
    return f"I'm the {agent_name}: that's all I do. Pick a job description, then ask me something like {sample}."


def check_message(agent, message: str, has_answer_already: bool) -> Decision:
    """``agent`` is an AgentSpec: its own_terms / other_wants / keep_if say what counts as its job."""
    name, examples = agent.name, agent.examples
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", message or "").strip()
    if not text or len(text) < 2:
        return _blocked("empty", "Tell me what you'd like, for example: " + (examples[0] if examples else "generate questions") + ".")
    if len(text) > MAX_MESSAGE_CHARS:
        return _blocked("too_long", f"Please keep the request under {MAX_MESSAGE_CHARS:,} characters.")
    if injection_flags(text):
        return _blocked("injection", "I can't act on instructions that try to change how I work. Ask me for the task itself.")

    own_hit = bool(agent.own_terms.search(text))
    if agent.other_wants.search(text) and not agent.keep_if.search(text):
        return _blocked("wrong_agent", f"That's a job for the {agent.other_agent_name}. I only handle {name.lower()} requests.")
    if _OFF_TOPIC.search(text) and not own_hit:
        return _blocked("off_topic", _capabilities(name, examples))
    # a first message with no sign of the task at all is not allowed to burn a model call; a follow-up ("make it shorter") is
    if not own_hit and not has_answer_already and len(text.split()) < 3:
        return _blocked("off_topic", _capabilities(name, examples))
    return Decision(True)
