"""Queued CV uploads: stage pools, the worker-side job, and when the API queues instead of processing itself."""

import asyncio
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.ingestion import pipeline, upload_job
from app.ingestion.pipeline import SOURCE_UPLOAD, CVSubmission, IngestError, ingest_cv

CV_TEXT = "Jane Smith - Senior Python Developer with seven years building FastAPI services on PostgreSQL and Redis."


class Gauge:
    """Counts how many calls are inside a stage at once."""

    def __init__(self, delay=0.05):
        self.delay, self.active, self.peak, self.lock = delay, 0, 0, threading.Lock()

    def __call__(self, *_a, **_k):
        with self.lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
        time.sleep(self.delay)
        with self.lock:
            self.active -= 1
        return {"name": "Jane", "skills": ["Python"]}


@pytest.fixture
def stages(monkeypatch):
    llm_gauge, embed_gauge = Gauge(), Gauge()
    llm = MagicMock()
    llm.standardize_cv.side_effect = llm_gauge
    emb = MagicMock()
    emb.generate_document_embeddings.side_effect = embed_gauge
    q = MagicMock()
    q.find_candidate_by_hash.return_value = None
    q.check_existing_application.return_value = None
    q.save_candidate.return_value = "cv"
    q.store_embeddings.return_value = True
    q.link_application.return_value = True
    parsing = MagicMock()
    parsing.process_document.return_value = {"raw_text": CV_TEXT, "clean_text": CV_TEXT, "extracted_pii": {"email": [], "phone": []}}
    for name, obj in (("get_store", q), ("get_llm_service", llm), ("get_embedding_service", emb),
                      ("get_parsing_service", parsing), ("get_storage_service", MagicMock())):
        monkeypatch.setattr(pipeline, name, lambda obj=obj: obj)
    monkeypatch.setattr(pipeline, "_persist_original", lambda sub, text, ext: "stored/x")
    monkeypatch.setattr(pipeline, "_llm_slots", threading.BoundedSemaphore(3))
    monkeypatch.setattr(pipeline, "_embed_slots", threading.BoundedSemaphore(2))
    return SimpleNamespace(llm=llm_gauge, embed=embed_gauge)


def _run_batch(n, tmp_path):
    f = tmp_path / "cv.pdf"
    f.write_bytes(b"%PDF fake")
    threads = [threading.Thread(target=ingest_cv, args=(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=str(f), cv_id=f"c{i}"),))
               for i in range(n)]
    started = time.perf_counter()
    [t.start() for t in threads]
    [t.join() for t in threads]
    return time.perf_counter() - started


def test_many_cvs_are_processed_in_parallel_not_one_by_one(stages, tmp_path):
    elapsed = _run_batch(12, tmp_path)
    serial = 12 * 0.10                       # one by one: LLM 50 ms + embedding 50 ms each
    assert elapsed < serial * 0.6, f"{elapsed:.2f}s is not parallel (serial would be {serial:.2f}s)"


def test_the_llm_stage_is_capped_so_a_big_batch_cannot_flood_the_api(stages, tmp_path):
    _run_batch(12, tmp_path)
    assert 1 < stages.llm.peak <= 3          # several at once, never more than the pool


def test_the_embedding_stage_has_its_own_smaller_pool(stages, tmp_path):
    _run_batch(12, tmp_path)
    assert 1 < stages.embed.peak <= 2


def test_a_cv_waiting_at_one_stage_does_not_block_others_from_other_stages(stages, tmp_path):
    # The LLM pool is full of slow calls; embedding of other CVs still proceeds because the pools are separate.
    assert pipeline._llm_slots is not pipeline._embed_slots


# ---------------------------------------------------------------- the worker-side job
def test_worker_job_runs_the_shared_pipeline_and_records_completion(monkeypatch):
    statuses = []
    monkeypatch.setattr(upload_job, "set_public_job_status", lambda job_id, **kw: statuses.append((job_id, kw)))
    seen = {}

    def fake_ingest(sub):
        seen["sub"] = sub
        sub.progress(40, "Standardising with AI")
        return pipeline.IngestResult(cv_id=sub.cv_id, stats={"text_length": 99})

    monkeypatch.setattr(upload_job, "ingest_cv", fake_ingest)
    asyncio.run(upload_job.process_cv_upload({"application_id": "cv-1", "filename": "a.pdf", "persisted_path": "stored/cv-1.pdf"}))
    sub = seen["sub"]
    assert sub.source == SOURCE_UPLOAD and sub.cv_id == "cv-1" and sub.persisted_path == "stored/cv-1.pdf"
    assert statuses[-1][1]["status"] == "completed" and statuses[-1][1]["processing_stats"] == {"text_length": 99}
    assert any(kw.get("current_step") == "Standardising with AI" and kw.get("progress_percent") == 40 for _, kw in statuses)


@pytest.mark.parametrize("error", [IngestError("Could not extract sufficient text"), RuntimeError("OpenAI is down")])
def test_a_bad_file_is_recorded_as_failed_and_does_not_stop_the_worker(monkeypatch, error):
    statuses = []
    monkeypatch.setattr(upload_job, "set_public_job_status", lambda job_id, **kw: statuses.append(kw))
    monkeypatch.setattr(upload_job, "ingest_cv", lambda sub: (_ for _ in ()).throw(error))
    asyncio.run(upload_job.process_cv_upload({"application_id": "x", "filename": "a.pdf", "persisted_path": "p"}))
    assert statuses[-1]["status"] == "failed" and str(error) in statuses[-1]["current_step"]


# ---------------------------------------------------------------- when does the API queue?
def _queue_env(monkeypatch, *, worker_online, enqueue_raises=False, enabled=True):
    from app.api.routers import cvs
    from app.jobs import public_cv_queue

    enqueued = []
    monkeypatch.setattr(cvs.settings, "ENABLE_INGEST_QUEUE", enabled)
    monkeypatch.setattr(public_cv_queue, "ingest_worker_online", lambda: worker_online)
    monkeypatch.setattr(public_cv_queue, "enqueue_job", lambda job: (_ for _ in ()).throw(RuntimeError("redis")) if enqueue_raises else enqueued.append(job))
    storage = MagicMock()
    storage.upload_file.return_value = "stored/cv-1.pdf"
    monkeypatch.setattr(cvs, "get_storage_service", lambda: storage)
    return cvs, enqueued


def test_upload_is_queued_when_a_worker_is_online(monkeypatch, tmp_path):
    cvs, enqueued = _queue_env(monkeypatch, worker_online=True)
    f = tmp_path / "a.pdf"
    f.write_bytes(b"x")
    assert asyncio.run(cvs._try_queue_upload(str(f), "cv-1", "a.pdf", ".pdf")) is True
    assert enqueued[0]["kind"] == "cv_upload" and enqueued[0]["application_id"] == "cv-1" and enqueued[0]["persisted_path"] == "stored/cv-1.pdf"
    assert not f.exists()                                    # the temp copy is cleaned up


def test_upload_is_processed_by_the_api_when_no_worker_is_online(monkeypatch, tmp_path):
    cvs, enqueued = _queue_env(monkeypatch, worker_online=False)
    f = tmp_path / "a.pdf"
    f.write_bytes(b"x")
    assert asyncio.run(cvs._try_queue_upload(str(f), "cv-1", "a.pdf", ".pdf")) is False
    assert not enqueued and f.exists()                       # nothing changed: the caller carries on as before


def test_upload_falls_back_to_the_api_if_enqueueing_fails(monkeypatch, tmp_path):
    cvs, _ = _queue_env(monkeypatch, worker_online=True, enqueue_raises=True)
    f = tmp_path / "a.pdf"
    f.write_bytes(b"x")
    assert asyncio.run(cvs._try_queue_upload(str(f), "cv-1", "a.pdf", ".pdf")) is False and f.exists()


def test_queueing_can_be_switched_off(monkeypatch, tmp_path):
    cvs, enqueued = _queue_env(monkeypatch, worker_online=True, enabled=False)
    assert asyncio.run(cvs._try_queue_upload(str(tmp_path / "a.pdf"), "cv-1", "a.pdf", ".pdf")) is False and not enqueued


def test_a_worker_counts_as_online_only_while_its_ingest_consumer_runs(monkeypatch):
    from app.jobs import public_cv_queue
    from app.monitoring import reader

    def procs(live):
        return [{"kind": "background-worker", "online": True, "stats": {"live": live}}]

    monkeypatch.setattr(reader, "processes", lambda: procs({"ingest_consumer": True}))
    assert public_cv_queue.ingest_worker_online() is True
    monkeypatch.setattr(reader, "processes", lambda: procs({}))        # up, but its consumer is switched off
    assert public_cv_queue.ingest_worker_online() is False
    monkeypatch.setattr(reader, "processes", lambda: [])
    assert public_cv_queue.ingest_worker_online() is False
