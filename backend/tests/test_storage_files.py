"""Serving the original CV / JD file (the preview and download): from local storage, from S3, or the extracted text as the last resort.

In production the files are in S3, so the storage folder on the server is empty: the preview used to answer "not found"."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import require_core_app
from app.api.routers import storage as S


class FakeS3:
    base_dir = "/nonexistent-because-the-files-are-in-s3"

    def __init__(self, objects):
        self.objects = objects          # (doc_type, doc_id) -> bytes
        self.asked = []

    def _get_content_type(self, ext):
        return {".pdf": "application/pdf", ".txt": "text/plain"}.get(ext, "application/octet-stream")

    def download_file(self, doc_id, doc_type, file_ext, local_path):
        self.asked.append((doc_id, doc_type, file_ext))
        if (doc_type, doc_id) not in self.objects:
            raise Exception("no such key")
        with open(local_path, "wb") as f:
            f.write(self.objects[(doc_type, doc_id)])
        return local_path


def client(monkeypatch, storage, jds=None, cvs=None):
    monkeypatch.setattr(S, "get_storage_service", lambda: storage)
    monkeypatch.setattr(S, "get_store", lambda: SimpleNamespace(jd_document=lambda i: (jds or {}).get(i),
                                                                candidate_document=lambda i: (cvs or {}).get(i)))
    app = FastAPI()
    app.include_router(S.router, prefix="/api/storage")
    app.dependency_overrides[require_core_app] = lambda: SimpleNamespace(role="user", username="u")
    return TestClient(app)


def test_a_jd_kept_in_s3_is_fetched_from_the_bucket(monkeypatch):
    s3 = FakeS3({("jd", "j1"): b"%PDF-1.4 the job"})
    c = client(monkeypatch, s3, jds={"j1": {"filename": "Senior Dev.pdf", "file_path": "s3://bucket/jds/j1.pdf", "raw_text": "text"}})
    r = c.get("/api/storage/files/jd/j1")
    assert r.status_code == 200 and r.content == b"%PDF-1.4 the job"
    assert s3.asked == [("j1", "jd", ".pdf")]


def test_a_cv_kept_in_s3_is_fetched_from_the_bucket(monkeypatch):
    s3 = FakeS3({("cv", "c1"): b"cv bytes"})
    c = client(monkeypatch, s3, cvs={"c1": {"filename": "a.pdf", "file_path": "s3://bucket/cvs/c1.pdf", "raw_text": "t"}})
    assert c.get("/api/storage/files/cv/c1").content == b"cv bytes"


def test_a_jd_whose_file_was_never_stored_shows_its_text(monkeypatch):
    # the S3 upload failed when the JD was added (it only logs a warning): there is a record and text, but no file
    c = client(monkeypatch, FakeS3({}), jds={"j2": {"filename": "Role.docx", "file_path": None, "raw_text": "Python developer wanted"}})
    r = c.get("/api/storage/files/jd/j2")
    assert r.status_code == 200 and r.text == "Python developer wanted"
    assert r.headers["content-type"].startswith("text/plain") and "Role.txt" in r.headers["content-disposition"]


def test_text_is_shown_when_the_bucket_no_longer_has_the_file(monkeypatch):
    c = client(monkeypatch, FakeS3({}), jds={"j3": {"filename": "x.pdf", "file_path": "s3://bucket/jds/j3.pdf", "raw_text": "the text"}})
    assert c.get("/api/storage/files/jd/j3").text == "the text"


def test_an_unknown_id_or_a_document_with_nothing_stored_is_not_found(monkeypatch):
    c = client(monkeypatch, FakeS3({}), jds={"j4": {"filename": "x.pdf", "file_path": None, "raw_text": "  "}})
    assert c.get("/api/storage/files/jd/missing").status_code == 404
    r = c.get("/api/storage/files/jd/j4")
    assert r.status_code == 404 and "not stored" in r.json()["detail"]


def test_a_local_file_is_still_served_first(monkeypatch, tmp_path):
    (tmp_path / "jds").mkdir()
    (tmp_path / "jds" / "j5.pdf").write_bytes(b"%PDF local")
    storage = SimpleNamespace(base_dir=str(tmp_path), _get_content_type=lambda ext: "application/pdf")
    c = client(monkeypatch, storage, jds={"j5": {"filename": "Local.pdf", "file_path": str(tmp_path / "jds" / "j5.pdf"), "raw_text": "t"}})
    r = c.get("/api/storage/files/jd/j5")
    assert r.status_code == 200 and r.content == b"%PDF local"


@pytest.mark.parametrize("bad", ["..%2Fx", "a.b", "x y"])
def test_bad_ids_are_refused(monkeypatch, bad):
    c = client(monkeypatch, FakeS3({}))
    assert c.get(f"/api/storage/files/jd/{bad}").status_code in (400, 404)


# ---- a JD's stored original goes when the JD does ---------------------------------------------------------------------------
def _jd_client(monkeypatch, doc, storage):
    from app.api.routers import job_descriptions as J
    store = SimpleNamespace(jd_document=lambda i: doc, delete_job_description=lambda i: "Role.pdf")
    monkeypatch.setattr(J, "get_store", lambda: store)
    monkeypatch.setattr(J, "get_storage_service", lambda: storage)
    app = FastAPI()
    app.include_router(J.router, prefix="/api/jd")
    app.dependency_overrides[J.require_core_app] = lambda: SimpleNamespace(role="user", username="u")
    return TestClient(app)


def test_deleting_a_jd_deletes_its_file_from_storage(monkeypatch):
    gone = []
    storage = SimpleNamespace(delete_file=lambda *a: gone.append(a))
    c = _jd_client(monkeypatch, {"file_path": "s3://bucket/jds/jd1.pdf", "filename": "Role.pdf"}, storage)
    assert c.delete("/api/jd/jd/jd1").status_code == 200
    assert gone == [("jd1", "jd", ".pdf")]


def test_a_jd_file_that_is_not_named_for_it_is_left_alone_and_a_storage_error_does_not_fail_the_delete(monkeypatch):
    gone = []

    def boom(*a):
        gone.append(a)
        raise Exception("s3 down")

    c = _jd_client(monkeypatch, {"file_path": "s3://bucket/jds/other.pdf"}, SimpleNamespace(delete_file=boom))
    assert c.delete("/api/jd/jd/jd1").status_code == 200 and gone == []
    c = _jd_client(monkeypatch, {"file_path": "s3://bucket/jds/jd1.pdf"}, SimpleNamespace(delete_file=boom))
    assert c.delete("/api/jd/jd/jd1").status_code == 200 and gone == [("jd1", "jd", ".pdf")]
