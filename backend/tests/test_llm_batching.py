import pytest
"""Top-N LLM re-scoring: batches of CVs per request, run concurrently, failures isolated and never cached."""

import asyncio
import threading
import time

from app.config.settings import settings
from app.ingestion import llm_enhancement as le


class FakeLLM:
    """Stands in for the LLM matching service; records batch sizes and the peak number of concurrent calls."""

    def __init__(self, fail_first_n_calls=0, always_fail_marker=None):
        self.sizes, self.lock = [], threading.Lock()
        self.active = self.peak = 0
        self.fail_first = fail_first_n_calls
        self.always_fail_marker = always_fail_marker

    def analyze_cv_jd_fit_bulk(self, jd_text, candidates):
        with self.lock:
            self.sizes.append(len(candidates))
            self.active += 1
            self.peak = max(self.peak, self.active)
            should_fail = self.fail_first > 0 or any(c["cv_id"] == self.always_fail_marker for c in candidates)
            self.fail_first = max(0, self.fail_first - 1)
        time.sleep(0.05)
        with self.lock:
            self.active -= 1
        if should_fail:
            return [{"llm_score": 0, "fallback": True} for _ in candidates]
        return [{"llm_score": 80.0, "cv": c["cv_id"]} for c in candidates]


def _cands(n):
    return [{"cv_id": f"cv{i}", "cv_raw_text": "text", "semantic_score": 50.0} for i in range(n)]


def test_fifty_cvs_are_split_into_batches_of_ten_and_keep_their_order():
    llm = FakeLLM()
    out = asyncio.run(le._analyze_in_batches(llm, "jd", _cands(50), 10))
    assert sorted(llm.sizes) == [10] * 5
    assert [a["cv"] for a in out] == [f"cv{i}" for i in range(50)]


def test_uneven_remainder_gets_its_own_smaller_batch():
    llm = FakeLLM()
    out = asyncio.run(le._analyze_in_batches(llm, "jd", _cands(23), 10))
    assert sorted(llm.sizes) == [3, 10, 10] and len(out) == 23


def test_batches_run_concurrently_but_within_the_process_cap():
    llm = FakeLLM()
    asyncio.run(le._analyze_in_batches(llm, "jd", _cands(50), 10))
    assert 1 < llm.peak <= settings.LLM_MATCH_CONCURRENCY


def test_a_failed_batch_is_retried_once_then_succeeds():
    llm = FakeLLM(fail_first_n_calls=1)
    out = asyncio.run(le._analyze_in_batches(llm, "jd", _cands(10), 10))
    assert len(llm.sizes) == 2 and not any(a.get("fallback") for a in out)


def test_one_permanently_failing_batch_does_not_lose_the_others():
    llm = FakeLLM(always_fail_marker="cv15")
    out = asyncio.run(le._analyze_in_batches(llm, "jd", _cands(30), 10))
    flags = [bool(a.get("fallback")) for a in out]
    assert flags[:10] == [False] * 10 and flags[20:] == [False] * 10      # untouched batches succeed
    assert flags[10:20] == [True] * 10                                   # only the failing batch falls back


def test_progress_is_reported_as_each_batch_finishes():
    llm = FakeLLM()
    seen = []
    asyncio.run(le._analyze_in_batches(llm, "jd", _cands(50), 10, on_batch=lambda done, total: seen.append((done, total))))
    assert [d for d, _ in seen] == [1, 2, 3, 4, 5] and {t for _, t in seen} == {5}


def test_a_broken_progress_callback_never_breaks_the_analysis():
    llm = FakeLLM()

    def boom(done, total):
        raise RuntimeError("redis down")

    out = asyncio.run(le._analyze_in_batches(llm, "jd", _cands(20), 10, on_batch=boom))
    assert len(out) == 20


# ------------------------------------------------------------------------- an answer cut off at the output limit is still usable
def test_a_json_answer_cut_off_mid_way_keeps_everything_that_was_written():
    from app.providers.llm.service import LLMService

    svc = LLMService.__new__(LLMService)
    parse = svc._parse_json_response
    assert parse('{"job_title": "IT Engineer", "skills": ["a", "b", "c"') == {"job_title": "IT Engineer", "skills": ["a", "b", "c"]}
    assert parse('{"job_title": "IT Engineer", "skills": ["a", "b"], "years": 10, "cat') == {"job_title": "IT Engineer", "skills": ["a", "b"], "years": 10}
    assert parse('{"job_title": "IT Eng') == {"job_title": "IT Eng"}
    assert parse('```json\n{"a": 1, "b": [1, 2,') == {"a": 1, "b": [1, 2]}
    assert parse('{"a": {"b": 1}, "c": "x"}') == {"a": {"b": 1}, "c": "x"}                      # a complete answer is untouched
    assert parse('Here you go: {"a": 1} hope that helps') == {"a": 1}
    with pytest.raises(Exception):
        parse("I could not read that document.")


def test_the_cv_and_jd_extraction_calls_ask_for_enough_output():
    from app.providers.llm import service

    assert service.EXTRACTION_MAX_TOKENS >= 4000
