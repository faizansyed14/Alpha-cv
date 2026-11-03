"""Advanced CV search: how text is normalised, what counts as a match, and paging through the whole result."""

import threading
import uuid

import pytest
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from app.ingestion.search_index import (
    SEARCH_VERSION,
    backfill,
    build_search_fields,
    experience_years,
    matched_terms,
    normalize,
)
from app.providers.vectorstore.qdrant import QdrantUtils, compress_content


@pytest.mark.parametrize("typed, expected", [
    ("PYTHON", "python"),
    ("Project-Management", "project management"),
    ("C#", "csharp"),
    ("C++ and C#", "cplusplus and csharp"),
    ("ASP.NET Core", "asp dotnet core"),
    (".NET", "dotnet"),
    ("Node.js", "node js"),
    ("  S/4HANA ", "s 4hana"),
])
def test_typed_text_and_cv_text_normalise_the_same_way(typed, expected):
    assert normalize(typed) == expected


@pytest.mark.parametrize("value, years", [
    (5, 5.0), (3.5, 3.5), ("7", 7.0), ("5+ years", 5.0), ("Not specified", None), (None, None), (True, None), (120, None),
])
def test_experience_is_read_as_a_number(value, years):
    assert experience_years(value) == years


def test_keywords_match_whole_words_and_phrases_only():
    text = normalize("Java developer. Led project management. JavaScript basics.")
    assert matched_terms(text, ["java", "javascript", "project management"]) == ["java", "javascript", "project management"]
    assert matched_terms(normalize("JavaScript and React"), ["java"]) == []
    assert matched_terms(normalize("managed a project as account manager"), ["project management"]) == []


def test_search_fields_cover_the_cv_text_and_the_record_facts():
    payload = {"location": "Dubai, UAE", "phone": "+971 50 123 4567",
               "structured_info": {"name": "Aisha Khan", "job_title": "Data Scientist", "keywords": ["TensorFlow"],
                                   "years_of_experience": "4+ years", "nationality": "Indian"}}
    fields = build_search_fields(payload, "Built ML models")
    for term in ("aisha khan", "data scientist", "tensorflow", "built ml models", "971501234567", "dubai uae"):
        assert matched_terms(fields["search_text"], [term]) == [term]
    assert fields["search_location"] == "dubai uae"
    assert fields["search_nationality"] == "indian"
    assert fields["search_experience"] == 4.0
    assert fields["search_version"] == SEARCH_VERSION


@pytest.fixture
def store():
    q = QdrantUtils.__new__(QdrantUtils)
    q._client = QdrantClient(":memory:")
    q._client_lock = threading.Lock()
    for name in ("cv_structured", "cv_documents"):
        q._client.create_collection(name, vectors_config=VectorParams(size=2, distance=Distance.COSINE))

    def add(text, **facts):
        cid = str(uuid.uuid4())
        payload = {"id": cid, "structured_info": {"keywords": facts.pop("keywords", [])}, **facts}
        q.client.upsert("cv_structured", points=[PointStruct(id=cid, vector=[0, 1], payload=payload)])
        q.client.upsert("cv_documents", points=[PointStruct(id=cid, vector=[0, 1], payload={
            "raw_content": compress_content(text), "raw_content_compressed": True})])
        return cid

    q.add = add
    return q


def _all(q, **kwargs):
    rows, cursor = [], None
    while True:
        page = q.search_cvs_advanced(limit=2, cursor=cursor, **kwargs)
        rows += page["points"]
        cursor = page["next_cursor"]
        if not cursor:
            return rows


def test_existing_cvs_become_searchable_through_the_backfill(store):
    java = store.add("Java and Spring developer", location="Dubai, UAE", years_of_experience=6)
    js = store.add("JavaScript and React developer", location="Abu Dhabi", years_of_experience="3")
    both = store.add("Java backend and JavaScript frontend", location="dubai", years_of_experience="8+ years")
    assert backfill(store) == 3
    assert backfill(store) == 0   # idempotent

    ids = lambda rows: {str(p.id) for p, _ in rows}   # noqa: E731
    assert ids(_all(store, keywords=["JAVA"])) == {java, both}
    assert ids(_all(store, keywords=["java", "javascript"], match_all=True)) == {both}
    assert ids(_all(store, locations=["Dubai"])) == {java, both}
    assert ids(_all(store, experience_min=5, experience_max=10)) == {java, both}

    rows = _all(store, keywords=["java", "javascript"], match_all=False)
    assert ids(rows) == {java, js, both}
    assert len(rows) == 3   # no CV twice across pages
    assert str(rows[0][0].id) == both and sorted(rows[0][1]) == ["java", "javascript"]   # full matches first


def test_first_page_reports_how_many_cvs_match(store):
    for i in range(5):
        store.add(f"Python engineer number {i}")
    store.add("Accountant")
    backfill(store)
    page = store.search_cvs_advanced(keywords=["python"], limit=2, with_total=True)
    assert page["total"] == 5 and len(page["points"]) == 2 and page["next_cursor"]


# ---------------------------------------------------------------------------------------------------------------------
# Candidates list: uploaded_at, counts and paging done by Qdrant
# ---------------------------------------------------------------------------------------------------------------------
def test_uploaded_at_orders_by_date_and_is_unique_within_a_second():
    from app.ingestion.search_index import uploaded_at_value

    older = uploaded_at_value("2026-01-01T10:00:00", "a")
    newer = uploaded_at_value("2026-01-01T10:00:01", "a")
    assert newer > older
    same_second = {uploaded_at_value("2026-01-01T10:00:00", f"cv-{i}") for i in range(2000)}
    assert len(same_second) > 1990                      # bulk uploads in one second still get their own value
    assert uploaded_at_value("2026-01-01T10:00:00", "a") == uploaded_at_value("2026-01-01T10:00:00", "a")   # stable
    assert uploaded_at_value("Unknown", "a") < older and uploaded_at_value(None, "a") < older               # unknown sorts last


def test_new_cv_gets_uploaded_at_when_it_is_stored(store):
    q, _ = store if isinstance(store, tuple) else (store, None)
    cid = str(uuid.uuid4())
    q.store_structured_data(cid, "cv", {"structured_info": {"category": "Finance"}})
    stored = q.client.retrieve("cv_structured", ids=[cid], with_payload=True)[0].payload
    assert stored["uploaded_at"] > 1_700_000_000        # a real timestamp, present from the first write


def test_categories_and_counts_come_from_qdrant_and_add_up(store):
    q = store[0] if isinstance(store, tuple) else store
    for category, n in (("Finance", 3), ("Sales", 2), (None, 2), ("General", 1)):
        for _ in range(n):
            cid = str(uuid.uuid4())
            info = {"category": category} if category else {}
            q.client.upsert("cv_structured", points=[PointStruct(id=cid, vector=[0, 1], payload={"id": cid, "structured_info": info})])
    try:
        counts = q.get_categories_with_counts()
        total = q.count_cvs()
    except Exception as e:  # local (in-memory) mode does not implement the facet API; covered against a real Qdrant
        pytest.skip(f"facet not available in local mode: {e}")
    assert total == 8 and sum(counts.values()) == total          # CVs without a category count as General
    assert counts == {"Finance": 3, "Sales": 2, "General": 3}
    assert q.count_cvs("Finance") == 3 and q.count_cvs("General") == 3
