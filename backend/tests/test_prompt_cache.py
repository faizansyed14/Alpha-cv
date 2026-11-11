"""Prompt caching: where the breakpoints go, that nothing else about the request changes, and that the stable start is really stable."""
import copy

import pytest

from app.config.settings import settings
from app.providers.llm.service import LLMService

prep = LLMService._prepare_messages
CLAUDE = "anthropic/claude-haiku-5.5"


def blocks(m):
    return m["content"] if isinstance(m["content"], list) else None


def test_a_marked_prefix_is_split_into_a_cached_block_and_the_rest():
    msgs = [{"role": "user", "content": "STABLE INSTRUCTIONS\n\nCV: Jane", "cache_prefix": len("STABLE INSTRUCTIONS\n\n")}]
    out = prep(msgs, CLAUDE, "blocks")
    b = blocks(out[0])
    assert b[0] == {"type": "text", "text": "STABLE INSTRUCTIONS\n\n", "cache_control": {"type": "ephemeral"}} and b[1] == {"type": "text", "text": "CV: Jane"}
    assert "cache_prefix" not in out[0]


def test_the_callers_messages_are_never_changed():
    msgs = [{"role": "system", "content": "rules"}, {"role": "user", "content": "hello", "cache_prefix": 2}]
    before = copy.deepcopy(msgs)
    prep(msgs, CLAUDE, "rolling")
    assert msgs == before


@pytest.mark.parametrize("model", ["openai/gpt-5", "google/gemini-2.5-pro", "meta/llama"])
def test_other_models_get_plain_strings_and_no_markers(model):
    msgs = [{"role": "system", "content": "rules"}, {"role": "user", "content": "STABLE rest", "cache_prefix": 6}]
    out = prep(msgs, model, "rolling")
    assert out == [{"role": "system", "content": "rules"}, {"role": "user", "content": "STABLE rest"}]


def test_switching_it_off_sends_plain_strings(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROMPT_CACHE", False)
    out = prep([{"role": "user", "content": "abc def", "cache_prefix": 3}], CLAUDE, "rolling")
    assert out == [{"role": "user", "content": "abc def"}]


def test_rolling_marks_the_system_message_and_the_latest_user_message_only():
    msgs = [{"role": "system", "content": "sys"}, {"role": "user", "content": "first"}, {"role": "assistant", "content": "a"},
            {"role": "user", "content": "second"}]
    out = prep(msgs, CLAUDE, "rolling")
    marked = [i for i, m in enumerate(out) if blocks(m) and "cache_control" in blocks(m)[0]]
    assert marked == [0, 3]
    tools_loop = msgs + [{"role": "assistant", "content": None, "tool_calls": [{"id": "1"}]}, {"role": "tool", "tool_call_id": "1", "content": "{}"}]
    out = prep(tools_loop, CLAUDE, "rolling")
    assert [i for i, m in enumerate(out) if isinstance(m["content"], list)] == [0, 3]            # a tool result is never rewritten


def test_system_mode_marks_only_the_system_message():
    out = prep([{"role": "system", "content": "sys"}, {"role": "user", "content": "unique text"}], CLAUDE, "system")
    assert isinstance(out[0]["content"], list) and out[1]["content"] == "unique text"


def test_blocks_mode_marks_nothing_without_a_prefix():
    out = prep([{"role": "system", "content": "sys"}, {"role": "user", "content": "x"}], CLAUDE, "blocks")
    assert out == [{"role": "system", "content": "sys"}, {"role": "user", "content": "x"}]


def test_at_most_four_breakpoints_are_ever_used():
    msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u" * 50, "cache_prefix": 10}]
    out = prep(msgs, CLAUDE, "rolling")
    assert sum(1 for m in out if isinstance(m["content"], list) for b in m["content"] if "cache_control" in b) <= 4


def test_the_one_hour_ttl_is_passed_on(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROMPT_CACHE_TTL", "1h")
    out = prep([{"role": "user", "content": "abcdef", "cache_prefix": 3}], CLAUDE, "blocks")
    assert blocks(out[0])[0]["cache_control"] == {"type": "ephemeral", "ttl": "1h"}


def test_cv_and_jd_prompts_share_one_stable_start_whatever_the_document():
    svc = LLMService.__new__(LLMService)
    a, b = svc._build_cv_prompt("Jane, Python developer"), svc._build_cv_prompt("Omar, accountant with 12 years")
    pa, pb = a[0]["cache_prefix"], b[0]["cache_prefix"]
    assert pa == pb and a[0]["content"][:pa] == b[0]["content"][:pb]
    assert a[0]["content"][pa:] == "Jane, Python developer"
    j1, j2 = svc._build_jd_prompt("Senior .NET role"), svc._build_jd_prompt("Finance manager")
    assert j1[0]["content"][: j1[0]["cache_prefix"]] == j2[0]["content"][: j2[0]["cache_prefix"]]


def test_the_agentic_system_prompt_is_the_same_for_every_person_until_the_last_line():
    from app.agentic.specialists import registry
    from app.agentic.specialists.base import person_line

    spec = registry.get("jobs")
    one, two = spec.system_prompt("rita", "user"), spec.system_prompt("omar", "evp")
    assert one == two and "rita" not in one                                   # nothing about the person in the shared start
    assert person_line("rita", "user").strip().endswith("(role: user).")


def test_the_match_prompt_marks_the_end_of_the_instructions_and_job_description():
    from app.matching.llm_scoring import LLMMatchingService

    scorer = LLMMatchingService.__new__(LLMMatchingService)
    p1 = scorer._build_bulk_analysis_prompt("Senior Python role", [{"cv_id": "a", "cv_raw_text": "Jane"}])
    p2 = scorer._build_bulk_analysis_prompt("Senior Python role", [{"cv_id": "b", "cv_raw_text": "Omar"}, {"cv_id": "c", "cv_raw_text": "Li"}])
    k1, k2 = p1.find("**CANDIDATES**"), p2.find("**CANDIDATES**")
    assert k1 > 0 and p1[:k1] == p2[:k2]                                       # every batch of one match repeats this part exactly


def test_the_request_body_carries_the_markers_and_the_cache_figures_come_back(monkeypatch):
    sent = {}

    class Reply:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "{\"ok\": true}"}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 2100, "completion_tokens": 40, "cost": 0.0011,
                              "prompt_tokens_details": {"cached_tokens": 1900, "cache_write_tokens": 0}}}

    class Session:
        def post(self, url, json=None, timeout=None):
            sent["body"] = json
            return Reply()

    svc = LLMService.__new__(LLMService)
    svc.session, svc.base_url, svc.default_model, svc.max_retries, svc.base_delay = Session(), "http://x/chat/completions", CLAUDE, 1, 0
    monkeypatch.setattr(settings, "OPENROUTER_ZDR", False)
    r = svc._send_openai_request(svc._build_cv_prompt("Jane, Python developer"), max_tokens=100)
    first = sent["body"]["messages"][0]["content"]
    assert isinstance(first, list) and first[0]["cache_control"] == {"type": "ephemeral"} and "cache_prefix" not in sent["body"]["messages"][0]
    assert (r.success, r.tokens_in, r.tokens_cached, r.tokens_cache_write, r.cost_usd) == (True, 2100, 1900, 0, 0.0011)
