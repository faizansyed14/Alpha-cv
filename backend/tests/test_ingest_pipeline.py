"""One ingestion flow for uploads and job-page CVs, with candidate data joined into the one candidate row.

The AI calls (LLM, embedding model, file storage) are faked; the database and the vector store are the real ones (the isolated test
store from conftest: SQLite tables + in-memory Qdrant), so these tests check what is really written."""

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest

from app.config.settings import settings
from app.ingestion import pipeline
from app.ingestion.pipeline import SOURCE_JOB_PAGE, SOURCE_UPLOAD, CVSubmission, IngestError, ingest_cv
from app.store import get_store

CV_TEXT = "Jane Smith - Senior Python Developer with seven years building FastAPI services on PostgreSQL and Redis."
DIM = settings.EMBEDDING_DIM


def uid(n):
    """Qdrant point ids must be UUIDs, as the ids the app generates are."""
    return f"00000000-0000-0000-0000-{n:012d}"


def _real_pdf() -> bytes:
    """A genuine (tiny) PDF: the upload checks open the file, so a made-up "%PDF" string is rightly refused."""
    import fitz

    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Jane Doe, Python developer")
    out = doc.tobytes()
    doc.close()
    return out


def _unit(n):
    m = np.random.default_rng(3).normal(size=(n, DIM)).astype(np.float32)
    return (m / np.linalg.norm(m, axis=1, keepdims=True)).tolist()


def _embeddings():
    return {"skill_vectors": _unit(20), "responsibility_vectors": _unit(10), "job_title_vector": _unit(1)}


@pytest.fixture
def world(monkeypatch):
    llm = MagicMock()
    llm.standardize_cv.return_value = {"name": "Jane Smith", "job_title": "Python Developer", "skills": ["Python"],
                                       "nationality": "Unknown-from-llm", "location": "Somewhere", "category": "Software & Application Development"}
    emb = MagicMock()
    emb.generate_document_embeddings.side_effect = lambda _std: _embeddings()
    parsing = MagicMock()
    parsing.process_document.return_value = {"raw_text": CV_TEXT, "clean_text": CV_TEXT,
                                             "extracted_pii": {"email": ["jane@x.com"], "phone": ["+971501234567"]}}
    parsing.remove_pii_data.side_effect = lambda t: (t, {"email": [], "phone": []})
    for name, obj in (("get_llm_service", llm), ("get_embedding_service", emb), ("get_parsing_service", parsing),
                      ("get_storage_service", MagicMock())):
        monkeypatch.setattr(pipeline, name, lambda obj=obj: obj)
    monkeypatch.setattr(pipeline, "_persist_original", lambda sub, text, ext: f"stored/{sub.cv_id}{ext}")
    store = get_store()
    posting = store.create_job_posting({"job_description_id": store.save_job_description(
        {"id": "jd-1", "filename": "j.pdf", "raw_text": "Dev", "standardized": {"job_title": "Dev"}}), "public_token": "tok"})
    return SimpleNamespace(store=store, llm=llm, parsing=parsing, job=posting)


def _file(tmp_path, name="cv.pdf", body=b"%PDF-1.4 fake"):
    path = tmp_path / name
    path.write_bytes(body)
    return str(path)


def _row(store, cv_id):
    return store.candidate_detail(cv_id)


def test_upload_is_parsed_standardised_embedded_and_stored(world, tmp_path):
    result = ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path)))
    row = _row(world.store, result.cv_id)
    assert row["full_name"] == "Jane Smith" and row["email"] == "jane@x.com" and row["phone"] == "+971501234567"
    assert world.store.retrieve_embeddings(result.cv_id, "cv")                      # the vectors are in Qdrant ...
    assert world.store.get_structured_cv(result.cv_id)["job_title"] == "Python Developer"   # ... and the facts in the tables
    assert world.store.applications_for_job(world.job) == []                       # an upload applies to nothing


def test_job_page_facts_are_joined_into_the_record_and_win_over_the_llm(world, tmp_path):
    ingest_cv(CVSubmission(
        source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path), cv_id=uid(1),
        candidate={"name": "Jane S.", "email": "jane@form.com", "nationality": "Indian", "location": "Dubai",
                   "notice_period": "30 days", "expected_salary": 18000, "years_of_experience": 7},
        job={"job_id": world.job, "job_title": "Dev"}))
    row = _row(world.store, uid(1))
    assert (row["nationality"], row["location"], row["notice_period"]) == ("Indian", "Dubai", "30 days")
    assert float(row["expected_salary"]) == 18000 and row["email"] == "jane@form.com" and row["full_name"] == "Jane S."
    apps = world.store.applications_for_job(world.job)
    assert [a["id"] for a in apps] == [uid(1)]          # about the application: on the application


def test_blank_candidate_values_never_overwrite_what_the_cv_says(world, tmp_path):
    ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path), cv_id=uid(2),
                           candidate={"nationality": "", "location": None}, job={"job_id": world.job}))
    row = _row(world.store, uid(2))
    assert row["nationality"] == "Unknown-from-llm" and row["location"] == "Somewhere"


def test_every_door_produces_the_same_record_shape(world, tmp_path):
    """The upload page and the job page fill the same columns of the same table: nothing extra, nothing missing."""
    shapes = []
    for i, (source, job) in enumerate(((SOURCE_UPLOAD, None), (SOURCE_JOB_PAGE, {"job_id": world.job}))):
        r = ingest_cv(CVSubmission(source=source, filename="cv.pdf", file_path=_file(tmp_path, body=f"%PDF-1.4 fake {i}".encode()),
                                   cv_id=uid(20 + i), job=job))
        row = _row(world.store, r.cv_id)
        shapes.append((set(row), world.store.get_structured_cv(r.cv_id).keys()))
    assert shapes[0][0] == shapes[1][0] and set(shapes[0][1]) == set(shapes[1][1])


def test_the_same_file_again_is_joined_not_stored_twice(world, tmp_path):
    first = ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path)))
    world.llm.standardize_cv.reset_mock()
    result = ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path), cv_id=uid(10),
                                    candidate={"nationality": "Indian", "location": "Dubai"}, job={"job_id": world.job}))
    assert result.merged and result.cv_id == first.cv_id
    assert world.store.count_candidates() == 1 and not world.llm.standardize_cv.called           # no re-extraction, one candidate
    row = _row(world.store, first.cv_id)
    assert row["nationality"] == "Indian" and row["location"] == "Dubai"                      # what was typed replaces what was read
    assert [a["id"] for a in world.store.applications_for_job(world.job)] == [first.cv_id]


def test_same_file_for_a_different_job_is_a_new_application_of_the_same_candidate(world, tmp_path):
    other = world.store.create_job_posting({"job_description_id": "jd-1", "public_token": "tok2"})
    one = ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path), cv_id=uid(11), job={"job_id": world.job}))
    two = ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path), cv_id=uid(12), job={"job_id": other}))
    assert two.merged and two.cv_id == one.cv_id and world.store.count_candidates() == 1
    assert world.store.application_count(world.job) == 1 and world.store.application_count(other) == 1


def test_too_little_text_is_rejected_before_any_ai_call(world, tmp_path):
    world.parsing.process_document.return_value = {"raw_text": "hi", "clean_text": "hi", "extracted_pii": {}}
    with pytest.raises(IngestError) as exc:
        ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path)))
    assert exc.value.status == 400 and not world.llm.standardize_cv.called


def test_pasted_text_is_ingested_without_a_file(world):
    result = ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="text_input.txt", text=CV_TEXT))
    assert world.store.candidate_exists(result.cv_id)


def test_a_failed_vector_write_is_an_error_and_leaves_no_half_saved_candidate(world, tmp_path, monkeypatch):
    monkeypatch.setattr(world.store, "store_embeddings", lambda *a, **k: False)
    with pytest.raises(IngestError) as exc:
        ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path), cv_id=uid(13)))
    assert exc.value.status == 500
    assert not world.store.candidate_exists(uid(13)) and world.store.count_candidates() == 0


def test_a_failed_database_write_is_an_error_not_silent(world, tmp_path, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("database is down")

    monkeypatch.setattr(world.store, "save_candidate", boom)
    with pytest.raises(IngestError) as exc:
        ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path)))
    assert exc.value.status == 500


def test_progress_is_reported_in_order(world, tmp_path):
    seen = []
    ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path),
                           progress=lambda pct, msg: seen.append(pct)))
    assert seen == sorted(seen) and seen[0] < 10 and seen[-1] == 100


def _worker_data(**over):
    data = {"application_id": "app-7", "public_token": "tok", "applicant_name": "Jane", "applicant_email": "j@x.com",
            "nationality": "Indian", "location": "Dubai", "notice_period": "30 days", "expected_salary": 9000,
            "cv_file_path": "stored/app-7.pdf", "cv_filename": "cv.pdf", "content_sha256": "abc"}
    data.update(over)
    return data


def test_job_page_worker_function_feeds_the_form_fields_into_the_shared_pipeline(world, monkeypatch):
    from app.services import careers_service

    captured = {}
    monkeypatch.setattr(pipeline, "ingest_cv", lambda sub: captured.setdefault("sub", sub) and pipeline.IngestResult(cv_id=sub.cv_id))
    result = asyncio.run(careers_service.process_job_application_async(_worker_data()))
    sub = captured["sub"]
    assert result["success"] and sub.source == SOURCE_JOB_PAGE and sub.cv_id == "app-7"
    assert sub.candidate["nationality"] == "Indian" and sub.candidate["location"] == "Dubai"
    assert sub.job["job_id"] == world.job and sub.content_sha256 == "abc"


# ---------------------------------------------------------------- one application per person per job
def test_same_person_same_job_is_refused_by_the_pipeline_whichever_door(world, tmp_path):
    ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path, body=b"%PDF first"), cv_id=uid(3),
                           candidate={"email": "jane@x.com"}, job={"job_id": world.job}))
    world.llm.standardize_cv.reset_mock()
    with pytest.raises(pipeline.DuplicateApplication) as exc:
        ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv2.pdf", file_path=_file(tmp_path, "cv2.pdf", b"%PDF second"),
                               cv_id=uid(4), candidate={"email": "Jane@X.com"}, job={"job_id": world.job}))
    assert exc.value.status == 409 and exc.value.existing_id == uid(3)
    assert not world.store.candidate_exists(uid(4)) and not world.llm.standardize_cv.called      # nothing stored, no AI spend


def test_a_cv_without_a_job_is_never_blocked_as_a_duplicate_application(world, tmp_path):
    ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path, body=b"%PDF a"), cv_id=uid(3),
                           candidate={"email": "jane@x.com"}, job={"job_id": world.job}))
    ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=_file(tmp_path, body=b"%PDF b"), cv_id=uid(8)))
    assert world.store.candidate_exists(uid(8))


def test_the_applicants_email_is_stored_lower_cased_so_the_check_always_finds_it(world, tmp_path):
    ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=_file(tmp_path), cv_id=uid(7),
                           candidate={"email": "  Jane.Smith@Example.COM "}, job={"job_id": world.job}))
    assert _row(world.store, uid(7))["email"] == "jane.smith@example.com"
    assert world.store.check_existing_application("JANE.smith@example.com", world.job)["id"] == uid(7)


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


def test_the_job_page_worker_reports_a_duplicate_and_does_not_free_the_claim(world, monkeypatch):
    from app.services import careers_service

    released = []
    monkeypatch.setattr(pipeline, "release_application", lambda *a: released.append(a))
    monkeypatch.setattr(pipeline, "ingest_cv", lambda sub: (_ for _ in ()).throw(pipeline.DuplicateApplication("first")))
    result = asyncio.run(careers_service.process_job_application_async(_worker_data(application_id="a", cv_file_path="p")))
    assert result["success"] is False and result["duplicate"] is True and not released


def test_the_job_page_worker_frees_the_claim_when_processing_fails(world, monkeypatch):
    from app.services import careers_service

    released = []
    monkeypatch.setattr(pipeline, "release_application", lambda *a: released.append(a))
    monkeypatch.setattr(pipeline, "ingest_cv", lambda sub: (_ for _ in ()).throw(IngestError("unreadable")))
    asyncio.run(careers_service.process_job_application_async(_worker_data(application_id="a", cv_file_path="p")))
    assert released == [("j@x.com", world.job, "a")]


# ---------------------------------------------------------------- the real duplicate check (the tables)
def test_the_real_check_finds_job_page_records_but_not_other_jobs_or_plain_uploads(world):
    store = world.store
    other = store.create_job_posting({"job_description_id": "jd-1", "public_token": "tok2"})
    for i, (email, job) in enumerate((("jane@x.com", world.job), ("Bob@X.com", other), ("carol@x.com", None))):
        cid = store.save_candidate({"id": f"00000000-0000-0000-0000-{i:012d}", "content_sha256": f"{i:064d}", "filename": "c.pdf",
                                    "facts": {"full_name": "N", "email": email}})
        if job:
            store.link_application(job, cid, {})
    assert store.check_existing_application("jane@x.com", world.job)["id"].endswith("0")
    assert store.check_existing_application("JANE@x.com", world.job) is not None             # case-insensitive input
    assert store.check_existing_application("Bob@X.com", other) is not None
    assert store.check_existing_application("jane@x.com", other) is None                     # different job
    assert store.check_existing_application("carol@x.com", world.job) is None                # an upload is not an application


# ---------------------------------------------------------------- the apply form's answer
def _apply(client, email="Jane@x.com"):
    return client.post("/api/careers/jobs/tok123/apply", data={
        "applicant_name": "Jane Smith", "applicant_email": email, "expected_salary": "9000",
        "years_of_experience": "5", "location": "Dubai", "nationality": "Indian", "notice_period": "30 days",
        "background_processing": "true"}, files={"cv_file": ("cv.pdf", _real_pdf(), "application/pdf")})


def test_applying_to_the_same_job_twice_gets_a_clear_409_before_anything_is_stored(monkeypatch):
    from fastapi.testclient import TestClient

    from app.api.routers import careers
    from app.main import app

    q = MagicMock()
    q.get_job_posting_by_token.return_value = {"id": "job-1", "is_active": True, "job_title": "Dev"}
    q.check_existing_application.return_value = {"id": "first", "application_date": "2026-10-01"}
    monkeypatch.setattr(careers, "get_store", lambda: q)
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
    monkeypatch.setattr(careers, "get_store", lambda: q)
    monkeypatch.setattr(careers, "claim_application", lambda *a: False)
    resp = _apply(TestClient(app))
    assert resp.status_code == 409 and "being processed" in resp.json()["detail"]


def test_the_same_file_submitted_at_the_same_moment_by_two_workers_becomes_one_candidate(world, tmp_path, monkeypatch):
    """Both workers look the file up before either has stored it; the loser meets the unique file hash and joins the winner."""
    path = _file(tmp_path)
    first = ingest_cv(CVSubmission(source=SOURCE_UPLOAD, filename="cv.pdf", file_path=path, cv_id=uid(40)))
    real = world.store.find_candidate_by_hash
    calls = []

    def find(sha):
        calls.append(sha)
        return None if len(calls) == 1 else real(sha)            # the first look-up still sees nothing, as if the winner were not stored yet

    monkeypatch.setattr(world.store, "find_candidate_by_hash", find)
    second = ingest_cv(CVSubmission(source=SOURCE_JOB_PAGE, filename="cv.pdf", file_path=path, cv_id=uid(41),
                                    candidate={"nationality": "Indian"}, job={"job_id": world.job}))
    assert second.merged and second.cv_id == first.cv_id
    assert world.store.count_candidates() == 1 and not world.store.candidate_exists(uid(41))
    assert world.store.candidate_detail(first.cv_id)["nationality"] == "Indian"
    assert [a["id"] for a in world.store.applications_for_job(world.job)] == [first.cv_id]
