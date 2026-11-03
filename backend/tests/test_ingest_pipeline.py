"""One ingestion flow for uploads, Naukri/email and job-page CVs, with candidate data joined into the record."""

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.ingestion import pipeline
from app.ingestion.pipeline import (SOURCE_EMAIL, SOURCE_JOB_PAGE, SOURCE_UPLOAD, CVSubmission, IngestError,
                                    ingest_cv)

CV_TEXT = "Jane Smith - Senior Python Developer with seven years building FastAPI services on PostgreSQL and Redis."


class FakeQdrant:
    def __init__(self, existing=None):
        self.documents, self.structured, self.embeddings, self.links, self.patches = {}, {}, {}, [], []
        self.existing = existing
        self.client = SimpleNamespace(set_payload=lambda **kw: self.patches.append(kw))
        self.fail_structured = False

    def check_existing_application(self, email, job_id):
        return None

    def find_cv_by_content_hash(self, sha):
        return self.existing

    def store_document(self, cv_id, doc_type, filename, fmt, raw, date, path, mime):
        self.documents[cv_id] = {"filename": filename, "format": fmt, "path": path, "mime": mime}
        return True

    def store_structured_data(self, cv_id, doc_type, payload):
        if self.fail_structured:
            return False
        stored = {**payload, "id": cv_id}
        stored.setdefault("structured_info", payload)      # what QdrantUtils.store_structured_data does
        self.structured[cv_id] = stored
        return True

    def store_embeddings_exact(self, cv_id, doc_type, emb):
        self.embeddings[cv_id] = emb
        return True

    def link_application_to_job(self, cv_id, job_id, data, filename, date):
        self.links.append((cv_id, job_id, data))
        return True


@pytest.fixture
def world(monkeypatch):
    q = FakeQdrant()
    llm = MagicMock()
    llm.standardize_cv.return_value = {"name": "Jane Smith", "job_title": "Python Developer", "skills": ["Python"],
                                       "nationality": "Unknown-from-llm", "location": "Somewhere"}
    emb = MagicMock()
    emb.generate_document_embeddings.return_value = {"skill_vectors": [[0.1]]}
    storage = MagicMock()
    storage.upload_file.side_effect = lambda path, cv_id, kind, ext: f"stored/{cv_id}{ext}"
    parsing = MagicMock()
    parsing.process_document.return_value = {"raw_text": CV_TEXT, "clean_text": CV_TEXT,
                                             "extracted_pii": {"email": ["jane@x.com"], "phone": ["+971501234567"]}}
    parsing.remove_pii_data.side_effect = lambda t: (t, {"email": [], "phone": []})
    cache = MagicMock()
    for name, obj in (("get_qdrant_utils", q), ("get_llm_service", llm), ("get_embedding_service", emb),
                      ("get_storage_service", storage), ("get_parsing_service", parsing), ("get_cache_service", cache)):
        monkeypatch.setattr(pipeline, name, lambda obj=obj: obj)
    monkeypatch.setattr(pipeline, "_persist_original", lambda sub, text, ext: f"stored/{sub.cv_id}{ext}")
    return SimpleNamespace(q=q, llm=llm, parsing=parsing, cache=cache)


def _file(tmp_path, name="cv.pdf"):
    path = tmp_path / name
    path.write_bytes(b"%PDF-1.4 fake")
    return str(path)


def test_upload_is_parsed_standardised_embedded_and_stored(world, tmp_path):
    result = ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path)))
    rec = world.q.structured[result.cv_id]
    assert rec["source"] == SOURCE_UPLOAD and rec["email"] == "jane@x.com" and rec["phone"] == "+971501234567"
    assert result.cv_id in world.q.documents and result.cv_id in world.q.embeddings
    assert not world.q.links and "is_job_application" not in rec
    world.cache.delete.assert_called()


def test_job_page_facts_are_joined_into_the_record_and_win_over_the_llm(world, tmp_path):
    sub = CVSubmission(
        source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path), cv_id="app-1",
        candidate={"name": "Jane S.", "email": "jane@form.com", "nationality": "Indian", "location": "Dubai",
                   "notice_period": "30 days", "expected_salary": 18000, "years_of_experience": 7},
        job={"job_id": "job-9", "job_title": "Dev"})
    ingest_cv(sub)
    rec = world.q.structured["app-1"]
    assert (rec["nationality"], rec["location"], rec["notice_period"]) == ("Indian", "Dubai", "30 days")
    assert rec["expected_salary"] == 18000 and rec["email"] == "jane@form.com" and rec["name"] == "Jane S."
    assert rec["structured_info"]["nationality"] == "Indian"           # searchable in either place
    assert rec["is_job_application"] and rec["job_posting_id"] == "job-9" and rec["source"] == SOURCE_JOB_PAGE
    cv_id, job_id, data = world.q.links[0]
    assert (cv_id, job_id, data["nationality"], data["location"]) == ("app-1", "job-9", "Indian", "Dubai")


def test_blank_candidate_values_never_overwrite_what_the_cv_says(world, tmp_path):
    ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path), cv_id="a",
                           candidate={"nationality": "", "location": None}, job={"job_id": "j"}))
    rec = world.q.structured["a"]
    assert rec["nationality"] == "Unknown-from-llm" and rec["location"] == "Somewhere"


def test_email_applications_use_the_same_flow_and_keep_the_naukri_source(world, tmp_path):
    ingest_cv(CVSubmission(source=SOURCE_EMAIL, filename="cv.pdf", file_path=_file(tmp_path), cv_id="m-1",
                           candidate={"email": "jane@naukri.com", "expected_salary": 15000},
                           job={"job_id": "job-3", "job_title": "Dev", "email_id": "E1", "subject_id": "S1"}))
    rec = world.q.structured["m-1"]
    assert rec["source"] == "email_application" and rec["email_id"] == "E1" and rec["expected_salary"] == 15000
    assert world.q.links[0][1] == "job-3"


def test_every_door_produces_the_same_record_shape(world, tmp_path):
    shapes = []
    for i, (source, job) in enumerate(((SOURCE_UPLOAD, None), (SOURCE_JOB_PAGE, {"job_id": "j"}),
                                       (SOURCE_EMAIL, {"job_id": "j"}))):
        world.q.existing = None
        r = ingest_cv(CVSubmission(source=source, filename="cv.pdf", file_path=_file(tmp_path), cv_id=f"c{i}",
                                   content_sha256=f"sha{i}", job=job))
        shapes.append(set(world.q.structured[r.cv_id]) - {"is_job_application", "job_posting_id"})
    assert shapes[0] == shapes[1] == shapes[2]


def test_the_same_file_again_is_joined_not_stored_twice(world, tmp_path):
    world.q.existing = {"id": "old", "source": SOURCE_UPLOAD, "sources": [SOURCE_UPLOAD], "structured_info": {"a": 1}}
    result = ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path),
                                    candidate={"nationality": "Indian", "location": "Dubai"},
                                    job={"job_id": "job-1"}))
    assert result.merged and result.cv_id == "old"
    assert not world.q.structured and not world.q.embeddings and not world.llm.standardize_cv.called  # no re-extraction
    patch = world.q.patches[0]
    assert patch["points"] == ["old"]
    assert patch["payload"]["nationality"] == "Indian" and patch["payload"]["sources"] == [SOURCE_UPLOAD, SOURCE_JOB_PAGE]
    assert patch["payload"]["structured_info"]["a"] == 1 and patch["payload"]["structured_info"]["location"] == "Dubai"
    assert world.q.links[0][:2] == ("old", "job-1")


def test_same_file_for_a_different_job_is_a_new_application(world, tmp_path):
    world.q.existing = {"id": "old", "job_id": "job-A", "source": SOURCE_JOB_PAGE}
    result = ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path), cv_id="new",
                                    job={"job_id": "job-B"}))
    assert not result.merged and result.cv_id == "new" and "new" in world.q.structured


def test_too_little_text_is_rejected_before_any_ai_call(world, tmp_path):
    world.parsing.process_document.return_value = {"raw_text": "hi", "clean_text": "hi", "extracted_pii": {}}
    with pytest.raises(IngestError) as exc:
        ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path)))
    assert exc.value.status == 400 and not world.llm.standardize_cv.called


def test_pasted_text_is_ingested_without_a_file(world):
    result = ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="text_input.txt", text=CV_TEXT))
    assert result.cv_id in world.q.structured


def test_a_failed_database_write_is_an_error_not_silent(world, tmp_path):
    world.q.fail_structured = True
    with pytest.raises(IngestError) as exc:
        ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path)))
    assert exc.value.status == 500


def test_progress_is_reported_in_order(world, tmp_path):
    seen = []
    ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path),
                           progress=lambda pct, msg: seen.append(pct)))
    assert seen == sorted(seen) and seen[0] < 10 and seen[-1] == 100


def test_job_page_worker_function_feeds_the_form_fields_into_the_shared_pipeline(monkeypatch):
    from app.services import careers_service

    captured = {}
    monkeypatch.setattr(pipeline, "ingest_cv", lambda sub: captured.setdefault("sub", sub) and
                        pipeline.IngestResult(cv_id=sub.cv_id))
    qdrant = MagicMock()
    qdrant.get_job_posting_by_token.return_value = {"id": "job-7", "job_title": "Dev"}
    monkeypatch.setattr("app.providers.vectorstore.qdrant.get_qdrant_utils", lambda: qdrant)

    result = asyncio.run(careers_service.process_job_application_async({
        "application_id": "app-7", "public_token": "tok", "applicant_name": "Jane", "applicant_email": "j@x.com",
        "nationality": "Indian", "location": "Dubai", "notice_period": "30 days", "expected_salary": 9000,
        "cv_file_path": "stored/app-7.pdf", "cv_filename": "cv.pdf", "content_sha256": "abc"}))
    sub = captured["sub"]
    assert result["success"] and sub.source == SOURCE_JOB_PAGE and sub.cv_id == "app-7"
    assert sub.candidate["nationality"] == "Indian" and sub.candidate["location"] == "Dubai"
    assert sub.job["job_id"] == "job-7" and sub.content_sha256 == "abc"


# ---------------------------------------------------------------- one application per person per job
def test_same_person_same_job_is_refused_by_the_pipeline_whichever_door(world, tmp_path):
    world.q.check_existing_application = lambda email, job: {"id": "first", "application_date": "2026-10-01"}
    with pytest.raises(pipeline.DuplicateApplication) as exc:
        ingest_cv(CVSubmission(source=SOURCE_EMAIL, filename="cv.pdf", file_path=_file(tmp_path), cv_id="second",
                               candidate={"email": "Jane@X.com"}, job={"job_id": "job-1"}))
    assert exc.value.status == 409 and exc.value.existing_id == "first" and "2026-10-01" in str(exc.value)
    assert not world.q.structured and not world.llm.standardize_cv.called       # nothing stored, no AI spend


def test_a_cv_without_a_job_is_never_blocked_as_a_duplicate_application(world, tmp_path):
    world.q.check_existing_application = lambda *a: {"id": "first"}
    ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path), cv_id="u1"))
    assert "u1" in world.q.structured


def test_the_applicants_email_is_stored_lower_cased_so_the_check_always_finds_it(world, tmp_path):
    ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path), cv_id="j1",
                           candidate={"email": "  Jane.Smith@Example.COM "}, job={"job_id": "j"}))
    assert world.q.structured["j1"]["email"] == "jane.smith@example.com"


def test_double_submit_is_stopped_by_the_claim_and_a_failure_frees_it(monkeypatch):
    import fakeredis

    client = fakeredis.FakeRedis()
    monkeypatch.setattr("app.providers.cache.redis.get_redis_cache",
                        lambda: SimpleNamespace(is_connected=True, redis_client=client))
    assert pipeline.claim_application("Jane@x.com", "job-1", "attempt-1") is True
    assert pipeline.claim_application("jane@x.com", "job-1", "attempt-2") is False      # same person, same job
    assert pipeline.claim_application("jane@x.com", "job-2", "attempt-3") is True       # another job is fine
    pipeline.release_application("jane@x.com", "job-1", "someone-else")                 # not the owner: ignored
    assert pipeline.claim_application("jane@x.com", "job-1", "attempt-4") is False
    pipeline.release_application("jane@x.com", "job-1", "attempt-1")                     # failed attempt frees it
    assert pipeline.claim_application("jane@x.com", "job-1", "attempt-5") is True


def test_without_redis_the_claim_never_blocks_an_application(monkeypatch):
    monkeypatch.setattr("app.providers.cache.redis.get_redis_cache", lambda: SimpleNamespace(is_connected=False))
    assert pipeline.claim_application("a@b.com", "job", "x") is True


def test_the_job_page_worker_reports_a_duplicate_and_does_not_free_the_claim(monkeypatch):
    from app.services import careers_service

    released = []
    monkeypatch.setattr(pipeline, "release_application", lambda *a: released.append(a))
    monkeypatch.setattr(pipeline, "ingest_cv", lambda sub: (_ for _ in ()).throw(pipeline.DuplicateApplication("first")))
    qdrant = MagicMock()
    qdrant.get_job_posting_by_token.return_value = {"id": "job-7"}
    monkeypatch.setattr("app.providers.vectorstore.qdrant.get_qdrant_utils", lambda: qdrant)
    result = asyncio.run(careers_service.process_job_application_async(
        {"application_id": "a", "public_token": "t", "applicant_email": "j@x.com", "cv_file_path": "p", "cv_filename": "c.pdf"}))
    assert result["success"] is False and result["duplicate"] is True and not released


def test_the_job_page_worker_frees_the_claim_when_processing_fails(monkeypatch):
    from app.services import careers_service

    released = []
    monkeypatch.setattr(pipeline, "release_application", lambda *a: released.append(a))
    monkeypatch.setattr(pipeline, "ingest_cv", lambda sub: (_ for _ in ()).throw(IngestError("unreadable")))
    qdrant = MagicMock()
    qdrant.get_job_posting_by_token.return_value = {"id": "job-7"}
    monkeypatch.setattr("app.providers.vectorstore.qdrant.get_qdrant_utils", lambda: qdrant)
    asyncio.run(careers_service.process_job_application_async(
        {"application_id": "a", "public_token": "t", "applicant_email": "j@x.com", "cv_file_path": "p", "cv_filename": "c.pdf"}))
    assert released == [("j@x.com", "job-7", "a")]


# ---------------------------------------------------------------- the real Qdrant filter (in-memory Qdrant)
def _memory_qdrant():
    from qdrant_client import QdrantClient
    from qdrant_client.http.models import Distance, PointStruct, VectorParams

    from app.providers.vectorstore.qdrant import QdrantUtils

    client = QdrantClient(":memory:")
    client.create_collection("cv_structured", vectors_config=VectorParams(size=4, distance=Distance.COSINE))
    client.upsert("cv_structured", [
        PointStruct(id=1, vector=[0.1] * 4, payload={"id": "new-style", "email": "jane@x.com", "job_posting_id": "job-1",
                                                      "is_job_application": True, "application_date": "d1"}),
        PointStruct(id=2, vector=[0.1] * 4, payload={"id": "old-style", "email": "Bob@X.com", "job_id": "job-2",
                                                      "is_job_application": True}),
        PointStruct(id=3, vector=[0.1] * 4, payload={"id": "plain-upload", "email": "carol@x.com"}),
    ])
    utils = QdrantUtils.__new__(QdrantUtils)
    utils._client = client
    return utils


def test_the_real_check_finds_job_page_and_email_records_but_not_other_jobs_or_plain_uploads():
    q = _memory_qdrant()
    assert q.check_existing_application("jane@x.com", "job-1")["id"] == 1                  # job_posting_id record
    assert q.check_existing_application("JANE@x.com", "job-1") is not None                 # case-insensitive input
    assert q.check_existing_application("Bob@X.com", "job-2") is not None                  # older record: job_id key
    assert q.check_existing_application("jane@x.com", "job-2") is None                     # different job
    assert q.check_existing_application("carol@x.com", "job-1") is None                    # upload is not an application


# ---------------------------------------------------------------- the apply form's answer
def _apply(client, email="Jane@x.com"):
    return client.post("/api/careers/jobs/tok123/apply", data={
        "applicant_name": "Jane Smith", "applicant_email": email, "expected_salary": "9000",
        "years_of_experience": "5", "location": "Dubai", "nationality": "Indian", "notice_period": "30 days",
        "background_processing": "true"}, files={"cv_file": ("cv.pdf", b"%PDF-1.4 " + b"x" * 500, "application/pdf")})


def test_applying_to_the_same_job_twice_gets_a_clear_409_before_anything_is_stored(monkeypatch):
    from fastapi.testclient import TestClient

    from app.api.routers import careers
    from app.main import app

    q = MagicMock()
    q.get_job_posting_by_token.return_value = {"id": "job-1", "is_active": True, "job_title": "Dev"}
    q.check_existing_application.return_value = {"id": "first", "application_date": "2026-10-01"}
    monkeypatch.setattr(careers, "get_qdrant_utils", lambda: q)
    storage = MagicMock()
    monkeypatch.setattr(careers, "get_storage_service", lambda: storage)

    resp = _apply(TestClient(app))
    assert resp.status_code == 409 and "already applied" in resp.json()["detail"]
    q.check_existing_application.assert_called_once_with("jane@x.com", "job-1")      # normalised e-mail
    storage.upload_file.assert_not_called()                                           # nothing was stored


def test_a_second_submit_while_the_first_is_processing_is_refused(monkeypatch):
    from fastapi.testclient import TestClient

    from app.api.routers import careers
    from app.main import app

    q = MagicMock()
    q.get_job_posting_by_token.return_value = {"id": "job-1", "is_active": True, "job_title": "Dev"}
    q.check_existing_application.return_value = None                 # first one is not stored yet
    monkeypatch.setattr(careers, "get_qdrant_utils", lambda: q)
    monkeypatch.setattr(careers, "claim_application", lambda *a: False)
    resp = _apply(TestClient(app))
    assert resp.status_code == 409 and "being processed" in resp.json()["detail"]
