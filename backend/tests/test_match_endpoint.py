"""POST /api/match and GET /api/match/jobs/{id}: the queue-backed matching contract."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.deps import require_core_app
from app.jobs.match_queue import QueueFull
from app.main import app
from app.schemas.matching import MatchResponse, MatchWeights

ROUTER = "app.api.routers.matching"


@pytest.fixture
def client(mock_user):
    app.dependency_overrides[require_core_app] = lambda: mock_user
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def queue():
    """The match_queue module as seen by the router, with the queue enabled."""
    with patch(f"{ROUTER}.match_queue") as mq:
        mq.QueueFull = QueueFull
        mq.is_match_queue_enabled.return_value = True
        mq.enqueue_match.side_effect = None
        mq.queue_position.return_value = 2
        mq.estimate_wait_seconds.return_value = 180
        yield mq


def _job(status, **extra):
    return {"job_id": "job-1", "status": status, "progress": {"progress_percent": 10}, **extra}


def test_requires_jd_id_or_jd_text(client, queue):
    resp = client.post("/api/match", json={"cv_ids": ["cv_1"]})
    assert resp.status_code == 400
    assert "jd_id or jd_text" in resp.json()["detail"]


def test_rejects_requests_above_the_safety_ceiling(client, queue):
    with patch(f"{ROUTER}.settings") as cfg:
        cfg.MATCH_MAX_CVS = 2
        resp = client.post("/api/match", json={"jd_id": "jd_1", "cv_ids": ["a", "b", "c"]})
    assert resp.status_code == 400
    assert "safety ceiling" in resp.json()["detail"]
    queue.enqueue_match.assert_not_called()


def test_first_call_enqueues_and_reports_queue_position(client, queue):
    queue.enqueue_match.return_value = _job("queued")
    resp = client.post("/api/match", json={"jd_id": "jd_1", "cv_ids": ["cv_1"]})
    body = resp.json()
    assert resp.status_code == 200
    assert body["is_queued"] is True and body["job_id"] == "job-1"
    assert body["queue_position"] == 2 and body["estimated_wait_time"] == 180
    assert body["candidates"] == []


def test_running_job_reports_processing(client, queue):
    queue.enqueue_match.return_value = _job("processing")
    body = client.post("/api/match", json={"jd_id": "jd_1", "cv_ids": ["cv_1"]}).json()
    assert body["is_queued"] is True and body["status"] == "processing"


def test_completed_job_returns_the_full_result(client, queue):
    result = MatchResponse(jd_id="jd_1", normalized_weights=MatchWeights(), candidates=[]).dict()
    result["jd_job_title"] = "Python Developer"
    queue.enqueue_match.return_value = _job("completed", result=result)
    body = client.post("/api/match", json={"jd_id": "jd_1", "cv_ids": ["cv_1"]}).json()
    assert body["is_queued"] is False and body["jd_job_title"] == "Python Developer"


def test_failed_job_is_a_500_with_the_worker_error(client, queue):
    queue.enqueue_match.return_value = _job("failed", error="JD not found")
    resp = client.post("/api/match", json={"jd_id": "jd_1", "cv_ids": ["cv_1"]})
    assert resp.status_code == 500 and resp.json()["detail"] == "JD not found"


def test_queue_admission_limit_is_a_429_with_retry_after(client, queue):
    queue.enqueue_match.side_effect = QueueFull("You already have 3 matching jobs in progress.", retry_after=30)
    resp = client.post("/api/match", json={"jd_id": "jd_1", "cv_ids": ["cv_1"]})
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "30"


def test_size_does_not_change_the_flow(client, queue):
    queue.enqueue_match.return_value = _job("queued")
    for ids in (["a"], [str(i) for i in range(5000)]):
        assert client.post("/api/match", json={"jd_id": "jd_1", "cv_ids": ids}).json()["is_queued"] is True
    assert "size_hint" not in queue.enqueue_match.call_args.kwargs


def test_runs_inline_only_when_the_queue_is_switched_off_in_config(client, queue):
    queue.is_match_queue_enabled.return_value = False
    inline = MatchResponse(jd_id="jd_1", normalized_weights=MatchWeights(), candidates=[])
    with patch(f"{ROUTER}.settings") as cfg, \
            patch(f"{ROUTER}.run_match", new=AsyncMock(return_value=inline)) as run:
        cfg.ENABLE_MATCH_QUEUE = False
        cfg.MATCH_MAX_CVS = 0
        cfg.MATCHING_TIMEOUT_SECONDS = 30
        resp = client.post("/api/match", json={"jd_id": "jd_1", "cv_ids": ["cv_1"]})
    assert resp.status_code == 200 and resp.json()["is_queued"] is False
    run.assert_awaited_once()
    queue.enqueue_match.assert_not_called()


def test_queue_outage_is_a_503_not_a_cpu_spike_in_the_api(client, queue):
    queue.is_match_queue_enabled.return_value = False   # configured on, but Redis is down
    with patch(f"{ROUTER}.run_match", new=AsyncMock()) as run:
        resp = client.post("/api/match", json={"jd_id": "jd_1", "cv_ids": ["cv_1"]})
    assert resp.status_code == 503 and resp.headers["Retry-After"] == "15"
    run.assert_not_awaited()


def test_job_status_endpoint_404_for_unknown_job(client, queue):
    queue.get_job.return_value = None
    assert client.get("/api/match/jobs/nope").status_code == 404


def test_job_status_endpoint_reports_progress(client, queue):
    queue.get_job.return_value = _job("processing", params={"jd_id": "jd_1"})
    body = client.get("/api/match/jobs/job-1").json()
    assert body["is_queued"] is True and body["jd_id"] == "jd_1" and body["queue_position"] == 2
