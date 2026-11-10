"""One fact, one place: the layout of the data tables, and that Qdrant holds nothing but vectors."""

import numpy as np
from sqlalchemy import JSON
from sqlmodel import SQLModel

import app.models.talent  # noqa: F401
from app.config.settings import settings
from app.store import get_store

DIM = settings.EMBEDDING_DIM


def _unit(n):
    m = np.random.default_rng(1).normal(size=(n, DIM)).astype(np.float32)
    return (m / np.linalg.norm(m, axis=1, keepdims=True)).tolist()


EMB = {"skill_vectors": _unit(20), "responsibility_vectors": _unit(10), "job_title_vector": _unit(1)}


def test_no_table_stores_a_blob_of_json_to_hide_facts_in():
    """The lists are array columns (text[] in PostgreSQL; the SQLite of the tests uses a JSON variant of the same column)."""
    from sqlalchemy import ARRAY

    blobs = [(t.name, c.name) for t in SQLModel.metadata.sorted_tables if t.name.startswith(("candidate", "job_"))
             for c in t.columns if isinstance(c.type, JSON) and not isinstance(c.type, ARRAY) and not hasattr(c.type, "mapping")]
    assert blobs == []


def test_a_person_and_their_lists_are_columns_and_rows():
    candidate = SQLModel.metadata.tables["candidate"]
    for column in ("full_name", "email", "phone", "linkedin_url", "github_url", "location", "nationality", "notice_period",
                   "expected_salary", "job_title", "years_of_experience", "category", "uploaded_at"):
        assert column in candidate.columns, column
    for column in ("skills", "responsibilities", "keywords", "languages", "certifications"):
        assert column in candidate.columns, column                                            # the lists are columns of the one row
    assert {"candidate_id", "hr_user", "note"} <= set(SQLModel.metadata.tables["candidate_note"].columns.keys())
    tables = set(SQLModel.metadata.tables)
    assert not tables & {"candidate_skill", "candidate_responsibility", "candidate_keyword", "candidate_language", "candidate_certification",
                         "job_description_skill", "job_description_responsibility"}       # no table repeats the candidate's id for each item


def test_an_application_holds_only_what_is_about_the_application():
    cols = set(SQLModel.metadata.tables["job_application"].columns.keys())
    assert not cols & {"applicant_name", "applicant_email", "applicant_phone", "expected_salary", "location", "nationality", "cv_filename"}
    assert {"job_posting_id", "candidate_id", "status", "source", "applied_at"} == cols
    assert not {c for c in cols if c.startswith("match")} and "matched_at" not in cols       # a match is computed on demand, never stored


def test_qdrant_stores_vectors_and_no_facts():
    store = get_store()
    cid = store.save_candidate({"id": "00000000-0000-0000-0000-000000000001", "content_sha256": "a" * 64, "filename": "cv.pdf",
                                "raw_text": "some text", "facts": {"full_name": "Sam", "email": "sam@example.com"},
                                "skills": ["python"]})
    assert store.store_embeddings("cv", cid, EMB)
    points = store.vectors.client.retrieve("candidate_vectors", ids=[cid], with_payload=True, with_vectors=True)
    assert len(points) == 1 and not points[0].payload                         # nothing but the point id links it to the row
    assert set(points[0].vector) == {"skills", "responsibilities", "title"}
    assert len(points[0].vector["skills"]) == 20 and len(points[0].vector["responsibilities"]) == 10
    names = {c.name for c in store.vectors.client.get_collections().collections}
    assert names == {"candidate_vectors", "job_description_vectors"}
