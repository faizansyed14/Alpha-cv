"""Metrics pipeline: call sites -> recorder -> Redis rollups -> reader (what the Monitor page shows)."""

import fakeredis
import pytest

from app.monitoring import reader
from app.monitoring.recorder import Recorder, estimate_cost, percentile_from_buckets, timed


@pytest.fixture
def redis_client(monkeypatch):
    client = fakeredis.FakeRedis()
    monkeypatch.setattr(reader, "_redis", lambda: client)
    return client


@pytest.fixture
def rec(redis_client, monkeypatch):
    r = Recorder()
    monkeypatch.setattr(r, "_redis", lambda: redis_client)
    monkeypatch.setattr(r, "_ensure_started", lambda: None)  # no background thread: flush explicitly
    return r


def test_cost_estimate_uses_model_prices_and_ignores_unknown_models():
    assert estimate_cost("gpt-4.1-mini-2025-04-14", 1_000_000, 1_000_000) == pytest.approx(0.40 + 1.60)
    assert estimate_cost("some-new-model", 1000, 1000) == 0.0


def test_llm_calls_are_aggregated_by_role_with_tokens_cost_and_percentiles(rec):
    for ms in (120, 130, 140, 150, 3000):
        rec.record("llm", "match_analysis", "gpt-4.1-mini", ms, tokens_in=10_000, tokens_out=2_000)
    rec.record("llm", "cv_extract", "gpt-4.1-mini", 800, tokens_in=3_000, tokens_out=500)
    rec.flush()

    rows = {(r["role"]): r for r in reader.grouped(5, ("llm",))}
    m = rows["match_analysis"]
    assert m["calls"] == 5 and m["errors"] == 0
    assert m["tokens_in"] == 50_000 and m["tokens_out"] == 10_000
    assert m["cost_usd"] == pytest.approx(5 * (10_000 * 0.40 + 2_000 * 1.60) / 1e6)
    assert m["p50_ms"] == 250 and m["p95_ms"] == 5000     # bucket upper bounds
    assert rows["cv_extract"]["calls"] == 1


def test_failed_calls_are_counted_and_listed_as_events(rec):
    rec.record("llm", "match_analysis", "gpt-4.1-mini", 200, status="error", detail={"error": "429 rate limited"})
    rec.record("llm", "match_analysis", "gpt-4.1-mini", 210)
    rec.flush()
    assert reader.totals(5, "llm")["errors"] == 1
    failed = reader.events(failures_only=True)
    assert len(failed) == 1 and failed[0]["detail"]["error"] == "429 rate limited"
    assert len(reader.events(("llm",))) == 2     # model calls are always listed, so every call is inspectable


def test_api_calls_are_aggregated_but_not_listed_individually(rec):
    for _ in range(20):
        rec.record("api", "GET /api/cv/list", "http", 30)
    rec.flush()
    assert reader.totals(5, "api")["calls"] == 20
    assert reader.events(("api",)) == []


def test_timeseries_has_one_point_per_period_and_totals_match(rec):
    for _ in range(7):
        rec.record("job", "match", "fast", 4000)
    rec.flush()
    series = reader.timeseries(10, "job", points=10)
    assert sum(p["calls"] for p in series) == 7 and len(series) == 10


def test_timed_context_records_success_and_exception(redis_client, monkeypatch):
    from app.monitoring import recorder as module

    local = Recorder()
    monkeypatch.setattr(module, "_recorder", local)
    monkeypatch.setattr(local, "_redis", lambda: redis_client)
    monkeypatch.setattr(local, "_ensure_started", lambda: None)
    with timed("ocr", "page", "rapidocr"):
        pass
    with pytest.raises(ValueError):
        with timed("ocr", "page", "rapidocr"):
            raise ValueError("bad image")
    local.flush()
    row = reader.grouped(5, ("ocr",))[0]
    assert row["calls"] == 2 and row["errors"] == 1


def test_heartbeat_lists_processes_with_online_state(rec, redis_client):
    rec.set_kind("match-worker")
    rec.record("job", "match", "fast", 100)
    rec._heartbeat()
    procs = reader.processes()
    assert len(procs) == 1 and procs[0]["kind"] == "match-worker" and procs[0]["online"] is True
    assert procs[0]["stats"]["counters"]["job:match"] == 1


def test_unreachable_redis_drops_records_instead_of_raising(monkeypatch):
    r = Recorder()
    monkeypatch.setattr(r, "_redis", lambda: None)
    monkeypatch.setattr(r, "_ensure_started", lambda: None)
    r.record("llm", "x", "m", 10)
    r.flush()            # must not raise
    assert r.dropped == 1


def test_percentiles_from_buckets():
    assert percentile_from_buckets([0] * 13, 0.5) is None
    assert percentile_from_buckets([10] + [0] * 12, 0.95) == 10.0


def test_llm_service_records_tokens_role_and_failures(redis_client, monkeypatch):
    from app.monitoring import recorder as module
    from app.providers.llm.service import LLMResponse, LLMService

    local = Recorder()
    monkeypatch.setattr(module, "_recorder", local)
    monkeypatch.setattr("app.providers.llm.service.get_recorder", lambda: local)
    monkeypatch.setattr(local, "_redis", lambda: redis_client)
    monkeypatch.setattr(local, "_ensure_started", lambda: None)

    svc = LLMService.__new__(LLMService)      # skip __init__ (needs an API key)
    svc.default_model = "gpt-4.1-mini"
    responses = iter([
        LLMResponse(True, {}, 1.0, "gpt-4.1-mini", tokens_in=1000, tokens_out=100, attempts=2),
        LLMResponse(False, {}, 1.0, "gpt-4.1-mini", error_message="Timeout"),
    ])
    monkeypatch.setattr(svc, "_send_openai_request", lambda *a, **k: next(responses), raising=False)
    svc._call_openai_api([], role="match_analysis", detail={"cvs": 10})
    svc._call_openai_api([], role="match_analysis")
    local.flush()

    row = reader.grouped(5, ("llm",))[0]
    assert row["role"] == "match_analysis" and row["calls"] == 2 and row["errors"] == 1
    assert row["tokens_in"] == 1000 and row["tokens_out"] == 100 and row["cost_usd"] > 0
    ev = {e["status"]: e for e in reader.events(("llm",))}
    assert ev["ok"]["detail"] == {"cvs": 10, "attempts": 2} and ev["error"]["detail"]["error"] == "Timeout"


def test_a_process_is_online_as_soon_as_it_names_itself_even_before_recording_anything(redis_client, monkeypatch):
    import time

    r = Recorder()
    monkeypatch.setattr(r, "_redis", lambda: redis_client)
    monkeypatch.setattr("app.monitoring.recorder.Recorder._loop", lambda self: self._heartbeat())  # one beat, no sleep
    r.set_kind("match-worker")
    deadline = time.time() + 2
    while not reader.processes() and time.time() < deadline:
        time.sleep(0.02)
    procs = reader.processes()
    assert procs and procs[0]["kind"] == "match-worker" and procs[0]["online"]
