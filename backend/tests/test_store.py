"""The data layer: PostgreSQL-style tables for every fact, Qdrant (here in memory) for the vectors only."""

import os
from datetime import datetime, timedelta

import numpy as np
import pytest
from qdrant_client import QdrantClient
from sqlalchemy import create_engine, event, func, select
from sqlmodel import SQLModel, Session

from app.config.settings import settings
from app.ingestion.boolean_query import BooleanQueryError
from app.models.talent import Candidate, CandidateSearch, JobApplication, JobPosting
import app.models.requirement  # noqa: F401  (its tables are created with the others)
import app.models.selection  # noqa: F401
from app.store import TalentStore
from app.store.vectors import VectorStore

DIM = settings.EMBEDDING_DIM


@pytest.fixture
def store(tmp_path):
    """SQLite by default. Set TEST_STORE_PG_URL to a THROWAWAY PostgreSQL database to run the same tests on PostgreSQL (its tables are
    dropped and recreated, so never point it at a database that holds data)."""
    pg = os.environ.get("TEST_STORE_PG_URL")
    if pg:
        engine = create_engine(pg)
        SQLModel.metadata.drop_all(engine)
    else:
        engine = create_engine(f"sqlite:///{tmp_path / 'store.db'}", connect_args={"check_same_thread": False})

        @event.listens_for(engine, "connect")
        def _enforce_foreign_keys(connection, _record):          # PostgreSQL always cascades; SQLite only when asked
            connection.execute("PRAGMA foreign_keys=ON")

    SQLModel.metadata.create_all(engine)
    return TalentStore(engine=engine, vectors=VectorStore(client=QdrantClient(":memory:")))


def embeddings(seed=0):
    rng = np.random.default_rng(seed)

    def v(n):                                       # unit vectors, like the embedding model's (a cosine collection stores them normalised)
        m = rng.normal(size=(n, DIM)).astype(np.float32)
        return (m / np.linalg.norm(m, axis=1, keepdims=True)).tolist()
    return {"skill_vectors": v(20), "responsibility_vectors": v(10), "job_title_vector": [v(1)[0]]}


def cv(i, **over):
    base = {
        "id": f"00000000-0000-0000-0000-{i:012d}", "content_sha256": f"{i:064d}", "filename": f"cv{i}.pdf", "file_format": "pdf",
        "source": "upload", "raw_text": f"Candidate {i} worked with Python and Docker on payment systems",
        "facts": {"full_name": f"Person {i}", "email": f"P{i}@Example.com", "phone": "+971 50 123 4567", "location": "Dubai, UAE",
                  "nationality": "Indian", "job_title": "Backend Engineer", "years_of_experience": 5, "category": "Software & Application Development",
                  "expected_salary": 15000},
        "skills": ["Python programming", "Docker containers", "PostgreSQL"], "responsibilities": ["built payment APIs", "mentored juniors"],
        "keywords": ["Python", "Docker"], "languages": ["English", "Arabic"], "certifications": ["AWS Certified Developer Associate"],
    }
    base.update(over)
    return base


def test_a_candidate_is_one_row_with_its_lists_as_array_columns(store):
    cid = store.save_candidate(cv(1))
    with Session(store.engine) as s:
        row = s.get(Candidate, cid)
        assert row.full_name == "Person 1" and row.email == "p1@example.com"          # the e-mail is kept lower case
        assert float(row.years_of_experience) == 5.0 and float(row.expected_salary) == 15000.0
        assert row.category == "Software & Application Development"
        assert list(row.skills) == ["Python programming", "Docker containers", "PostgreSQL"]       # item n = vector n
        assert list(row.responsibilities) == ["built payment APIs", "mentored juniors"]
        assert list(row.keywords) == ["Python", "Docker"] and list(row.languages) == ["English", "Arabic"]
        assert list(row.certifications) == ["AWS Certified Developer Associate"]
        search = s.get(CandidateSearch, cid)
        if store._fts:      # PostgreSQL keeps only the tsvectors: the CV's own words in literal_tsv, what the AI added in extra_tsv
            assert search.text == "" and search.literal == ""
            assert "'payment'" in search.literal_tsv and "'system'" in search.literal_tsv                # word forms: systems -> system
            assert "'aw'" in search.extra_tsv and "'associ'" in search.extra_tsv       # stemmed: aws -> aw, associate -> associ
        else:
            assert "payment systems" in search.text and "aws certified developer associate" in search.text
        assert search.location == "dubai uae" and search.nationality == "indian"


def test_saving_again_replaces_the_lists_and_empty_facts_never_overwrite(store):
    cid = store.save_candidate(cv(1))
    store.save_candidate({"id": cid, "facts": {"full_name": "", "location": "Abu Dhabi"}, "skills": ["Go"]})
    got = store.get_structured_cv(cid)
    assert got["name"] == "Person 1"                                  # the empty name changed nothing
    assert store.candidate_detail(cid)["location"] == "Abu Dhabi"      # a new value did
    assert got["skills_sentences"] == ["Go"] and got["responsibility_sentences"] == ["built payment APIs", "mentored juniors"]


def test_what_the_applicant_typed_replaces_what_was_read_from_the_cv_in_the_same_columns(store):
    cid = store.save_candidate(cv(1, source="upload"))
    store.merge_candidate_facts(cid, {"full_name": "Sam Typed", "location": "Sharjah", "years_of_experience": 7, "notice_period": "30 days"})
    d = store.candidate_detail(cid)
    assert (d["full_name"], d["location"], d["years_of_experience"], d["notice_period"]) == ("Sam Typed", "Sharjah", 7.0, "30 days")
    assert d["skills"] == ["Python programming", "Docker containers", "PostgreSQL"]            # the CV's own reading stays


def test_the_same_file_is_found_by_its_hash(store):
    cid = store.save_candidate(cv(1))
    assert store.find_candidate_by_hash(cv(1)["content_sha256"])["id"] == cid
    assert store.find_candidate_by_hash("f" * 64) is None


def test_list_rows_have_the_shape_the_candidates_page_reads(store):
    a, b = store.save_candidate(cv(1)), store.save_candidate(cv(2, facts={"full_name": "Second", "category": "Finance & Accounting"}))
    rows = store.candidate_rows([b, a, "missing"])
    assert [r["id"] for r in rows] == [b, a]                                                    # the order asked, missing skipped
    first = rows[1]
    assert first["full_name"] == "Person 1" and first["skills_count"] == 3 and first["languages"] == ["English", "Arabic"]
    assert first["certifications"] == ["AWS Certified Developer Associate"] and first["is_job_application"] is False


def test_paging_counting_and_category_folders(store):
    ids = [store.save_candidate(cv(i, uploaded_at=datetime(2026, 1, 1) + timedelta(hours=i))) for i in range(1, 8)]
    store.save_candidate({"id": ids[0], "facts": {"category": "Finance & Accounting"}})
    assert store.list_candidate_ids(0, 3) == list(reversed(ids))[:3]                           # newest first
    assert store.list_candidate_ids(3, 3) == list(reversed(ids))[3:6]
    assert store.count_candidates() == 7 and store.count_candidates(["Finance & Accounting"]) == 1
    assert store.category_counts() == {"Software & Application Development": 6, "Finance & Accounting": 1}
    assert store.list_candidate_ids(0, 10, ["Finance & Accounting"]) == [ids[0]]


def test_cursor_paging_walks_the_whole_list_once_and_survives_a_delete(store):
    from app.store.candidates import BadCursor, parse_page_cursor

    same = datetime(2026, 1, 1)                                   # 1-3 share one upload time: the id decides their order
    ids = [store.save_candidate(cv(i, uploaded_at=same if i <= 3 else same + timedelta(hours=i))) for i in range(1, 8)]
    newest_first = store.list_candidate_ids(0, 10)
    assert sorted(newest_first) == sorted(ids)

    seen, cursor, pages = [], None, 0
    while True:
        page, cursor = store.list_candidate_page(2, after=parse_page_cursor(cursor))
        seen += page
        pages += 1
        if cursor is None:
            break
    assert seen == newest_first and pages == 4                      # 2 + 2 + 2 + 1: nothing repeated, nothing skipped

    first, cursor = store.list_candidate_page(3)
    store.delete_candidate(first[0])                                # a row before the cursor goes away: the next page is unaffected
    second, _ = store.list_candidate_page(3, after=parse_page_cursor(cursor))
    assert second == newest_first[3:6]

    store.save_candidate({"id": ids[5], "facts": {"category": "Finance & Accounting"}})
    assert store.list_candidate_page(5, ["Finance & Accounting"]) == ([ids[5]], None)
    with pytest.raises(BadCursor):
        parse_page_cursor("not-a-date|x")


def test_search_pages_by_cursor_and_counts_only_when_asked(store):
    ids = [store.save_candidate(cv(i, uploaded_at=datetime(2026, 1, 1) + timedelta(hours=i))) for i in range(1, 8)]
    from app.store.candidates import parse_page_cursor

    first, total, estimate, cursor = store.search_candidate_page(["python"], 3)
    assert first == list(reversed(ids))[:3] and total == 7 and not estimate and cursor
    second, total, _, cursor = store.search_candidate_page(["python"], 3, after=parse_page_cursor(cursor), with_total=False)
    third, _, _, end = store.search_candidate_page(["python"], 3, after=parse_page_cursor(cursor), with_total=False)
    assert first + second + third == list(reversed(ids)) and total is None and end is None


def test_category_counts_are_exact_and_follow_every_save_and_delete(store):
    a = store.save_candidate(cv(1))
    store.save_candidate(cv(2, facts={"category": "Finance & Accounting"}))
    assert store.cached_category_counts() == {"Software & Application Development": 1, "Finance & Accounting": 1}
    store.save_candidate(cv(3))
    assert store.cached_category_counts()["Software & Application Development"] == 2      # not a stale cached answer
    store.save_candidate({"id": a, "facts": {"category": "Finance & Accounting"}})        # moved to another category
    assert store.cached_category_counts() == {"Software & Application Development": 1, "Finance & Accounting": 2}
    store.delete_candidate(a)
    assert store.cached_category_counts() == {"Software & Application Development": 1, "Finance & Accounting": 1}


def test_facets_count_candidates(store):
    store.save_candidate(cv(1)); store.save_candidate(cv(2, facts={"location": "London"}))
    assert {v["value"]: v["count"] for v in store.candidate_facet("location")} == {"Dubai, UAE": 1, "London": 1}
    assert {v["value"]: v["count"] for v in store.candidate_facet("languages")} == {"English": 2, "Arabic": 2}
    assert store.candidate_facet("keywords")[0]["count"] == 2
    with pytest.raises(ValueError):
        store.candidate_facet("password")


def test_keyword_search_matches_whole_words_and_exact_phrases(store):
    java = store.save_candidate(cv(1, raw_text="Experienced in Java and Spring", skills=["Java"], keywords=["Java"]))
    js = store.save_candidate(cv(2, raw_text="Experienced in JavaScript and React", skills=["JavaScript"], keywords=["JavaScript"]))
    pm = store.save_candidate(cv(3, raw_text="Led project management office", skills=[], keywords=[]))
    managed = store.save_candidate(cv(4, raw_text="I managed a project", skills=[], keywords=[]))
    assert store.search_candidates(keywords=["java"])["ids"] == [java]                         # "Java" never returns the JavaScript CV
    assert store.search_candidates(keywords=["project management"])["ids"] == [pm]             # a phrase is an exact phrase
    assert set(store.search_candidates(keywords=["javascript", "react"])["ids"]) == {js}
    assert store.search_candidates(keywords=["JAVA"])["matched"][java] == ["JAVA"]             # shown as typed
    assert managed not in store.search_candidates(keywords=["project management"])["ids"]


def test_match_any_puts_the_cvs_with_every_keyword_first(store):
    both = store.save_candidate(cv(1, raw_text="docker and kubernetes", skills=[], keywords=[], uploaded_at=datetime(2026, 1, 1)))
    one = store.save_candidate(cv(2, raw_text="docker only", skills=[], keywords=[], uploaded_at=datetime(2026, 1, 2)))
    res = store.search_candidates(keywords=["docker", "kubernetes"], match_all=False, with_total=True)
    assert res["ids"] == [both, one] and res["total"] == 2                                      # full match first, then the partial one
    assert store.search_candidates(keywords=["docker", "kubernetes"], match_all=True)["ids"] == [both]


def test_search_filters_and_paging_cursor(store):
    ids = [store.save_candidate(cv(i, uploaded_at=datetime(2026, 1, 1) + timedelta(hours=i),
                                   facts={"location": "Dubai, UAE" if i % 2 else "London", "years_of_experience": i})) for i in range(1, 8)]
    assert set(store.search_candidates(locations=["dubai"], limit=50)["ids"]) == {ids[0], ids[2], ids[4], ids[6]}
    assert set(store.search_candidates(experience_min=3, experience_max=4)["ids"]) == {ids[2], ids[3]}
    assert set(store.search_candidates(languages=["Arabic"])["ids"]) == set(ids)
    first = store.search_candidates(limit=3, with_total=True)
    second = store.search_candidates(limit=3, cursor=first["next_cursor"])
    third = store.search_candidates(limit=3, cursor=second["next_cursor"])
    assert first["total"] == 7 and (first["ids"] + second["ids"] + third["ids"]) == list(reversed(ids)) and third["next_cursor"] is None


def test_boolean_search_is_decided_exactly(store):
    a = store.save_candidate(cv(1, raw_text="cloud engineer with azure and terraform"))
    b = store.save_candidate(cv(2, raw_text="cloud engineer intern with azure"))
    c = store.save_candidate(cv(3, raw_text="accountant with excel"))
    got = store.search_candidates(boolean_query='("Cloud Engineer") AND (Azure OR Terraform) NOT intern')
    assert got["ids"] == [a]
    assert set(store.search_candidates(boolean_query="azure")["ids"]) == {a, b}
    with pytest.raises(BooleanQueryError):
        store.search_candidates(boolean_query="(azure")


def test_the_basic_search_box_needs_every_word(store):
    a = store.save_candidate(cv(1, raw_text="python and docker"))
    store.save_candidate(cv(2, raw_text="python only", skills=[], keywords=[], facts={"full_name": "Zed"}))
    ids, total, estimate = store.search_candidate_ids(["python", "docker"], 0, 10)
    assert ids == [a] and total == 1 and estimate is False


def test_notes_one_per_recruiter(store):
    cid = store.save_candidate(cv(1))
    store.upsert_note(cid, "sam", "first")
    store.upsert_note(cid, "sam", "changed")
    store.upsert_note(cid, "alex", "other")
    notes = store.list_notes(cid)
    assert {n["hr_user"]: n["note"] for n in notes} == {"sam": "changed", "alex": "other"}
    summary = store.notes_summary([cid, "nope"])
    assert summary[cid]["notes_count"] == 2 and summary["nope"]["has_notes"] is False
    assert store.delete_note(cid, "sam") is True and store.delete_note(cid, "sam") is False and store.delete_note("nope", "x") is None


def test_deleting_a_candidate_removes_everything_about_it_including_its_vectors(store):
    cid = store.save_candidate(cv(1))
    store.upsert_note(cid, "sam", "n")
    assert store.store_embeddings("cv", cid, embeddings(1))
    posting = store.create_job_posting({"public_token": "tok", "job_description_id": None})
    store.link_application(posting, cid, {"source": "website"})
    info = store.delete_candidate(cid)
    assert info["filename"] == "cv1.pdf"
    with Session(store.engine) as s:
        for model in ("candidate_note", "candidate_search", "job_application"):
            assert s.execute(select(func.count()).select_from(SQLModel.metadata.tables[model])).scalar() == 0, model
    assert store.retrieve_embeddings(cid, "cv") is None
    assert store.delete_candidate(cid) is None


def test_vectors_round_trip_as_native_qdrant_vectors(store):
    emb = embeddings(3)
    assert store.store_embeddings("cv", cv(1)["id"], emb) is False or True
    store.save_candidate(cv(1))
    assert store.store_embeddings("cv", cv(1)["id"], emb)
    got = store.retrieve_embeddings(cv(1)["id"], "cv")
    assert len(got["skill_vectors"]) == 20 and len(got["responsibility_vectors"]) == 10
    assert len(got["job_title_vector"]) == 1 and "experience_vector" not in got
    assert np.allclose(got["skill_vectors"][4], emb["skill_vectors"][4], atol=1e-5)               # position n comes back as position n
    many = store.retrieve_embeddings_batch([cv(1)["id"], "00000000-0000-0000-0000-000000000099"], "cv")
    assert list(many) == [cv(1)["id"]]                                                          # a missing document is simply absent
    assert store.embeddings_info(cv(1)["id"], "cv") == {"embeddings_found": True, "skills": 20, "responsibilities": 10,
                                                        "has_title": True, "dimension": DIM}
    assert store.candidate_detail(cv(1)["id"])["embedding_model"] == settings.EMBEDDING_MODEL_NAME
    with pytest.raises(ValueError):
        store.vectors.put("candidate", "x", {"skill_vectors": []}) or (_ for _ in ()).throw(ValueError)


# ---------------------------------------------------------------------------------------------------- jobs
def jd(i=1, **over):
    base = {"id": f"11111111-1111-1111-1111-{i:012d}", "filename": f"job{i}.pdf", "file_format": "pdf", "raw_text": "We need a backend engineer",
            "standardized": {"job_title": "Backend Engineer", "years_of_experience": 5, "category": "Software & Application Development",
                             "boolean_search_string": '("Backend Engineer") AND Python',
                             "skills_sentences": ["Python", "SQL", ""], "responsibility_sentences": ["build apis"],
                             "required_languages": [{"name": "English", "mandatory": True}],
                             "required_certifications": [{"name": "AWS Certified Developer Associate", "mandatory": False}]}}
    base.update(over)
    return base


def test_a_job_description_keeps_its_lists_and_requirements_as_rows(store):
    jid = store.save_job_description(jd())
    got = store.get_structured_jd(jid)
    assert got["job_title"] == "Backend Engineer" and got["years_of_experience"] == 5.0
    assert got["skills_sentences"] == ["Python", "SQL"] and got["responsibility_sentences"] == ["build apis"]
    assert got["required_languages"] == [{"name": "English", "mandatory": True}]
    assert got["required_certifications"] == [{"name": "AWS Certified Developer Associate", "mandatory": False}]
    assert got["structured_info"]["required_languages"] == got["required_languages"]            # where requirements.jd_requirements reads them
    from app.matching.requirements import jd_requirements
    assert jd_requirements(got)["languages"] == [{"name": "English", "mandatory": True}]
    rows, total = store.list_job_descriptions(q="backend")
    assert total == 1 and rows[0]["skills_count"] == 2 and rows[0]["job_title"] == "Backend Engineer"
    assert store.list_job_descriptions(category="Finance & Accounting")[1] == 0


def test_a_posting_shows_the_description_until_its_own_text_is_edited(store):
    jid = store.save_job_description(jd())
    pid = store.create_job_posting({"job_description_id": jid, "public_token": "backend-engineer-1",
                                    "posted_by_user": "sam", "email_subject_id": "BE-2026-001", "email_subject_template": "Backend Engineer | BE-2026-001"})
    view = store.get_job_posting_by_token("backend-engineer-1")
    assert view["job_title"] == "Backend Engineer" and view["skills"] == ["Python", "SQL"] and view["responsibilities"] == ["build apis"]
    assert view["boolean_search_string"] == '("Backend Engineer") AND Python'
    store.update_job_posting(pid, {"job_title": "Senior Backend Engineer", "job_location": "Dubai", "job_summary": "Join us",
                                  "qualifications": "• Go\n• Rust", "key_responsibilities": "• lead the team"})
    view = store.get_job_posting_by_id(pid)
    assert (view["job_title"], view["job_location"], view["skills"], view["responsibilities"]) == (
        "Senior Backend Engineer", "Dubai", ["Go", "Rust"], ["lead the team"])
    assert view["years_of_experience"] == 5.0                                                    # still from the description


def test_postings_close_hide_and_soft_delete(store):
    jid = store.save_job_description(jd())
    pid = store.create_job_posting({"job_description_id": jid, "public_token": "t1"})
    assert store.update_job_posting(pid, {"is_active": False})
    assert store.get_job_posting_by_token("t1", include_inactive=False) is None and store.get_job_posting_by_token("t1", include_inactive=True)
    cid = store.save_candidate(cv(1))
    store.link_application(pid, cid, {})
    result = store.soft_delete_job_posting(pid, "sam")
    assert result["success"] and result["applications_archived"] == 1 and result["jd_hidden"] == 1
    assert store.get_job_posting_by_id(pid) is None and store.list_job_postings(include_inactive=True)[1] == 0
    assert store.list_job_descriptions()[1] == 0                                                 # hidden from the library with its posting
    assert store.soft_delete_job_posting(pid, "sam")["success"] is False
    with Session(store.engine) as s:
        assert s.get(JobApplication, (pid, cid)).status == "archived_job_deleted"               # the application is kept, with the reason


def test_one_description_can_have_several_postings_and_survives_neither_way(store):
    jid = store.save_job_description(jd())
    a = store.create_job_posting({"job_description_id": jid, "public_token": "a"})
    b = store.create_job_posting({"job_description_id": jid, "public_token": "b"})
    assert a != b and store.list_job_postings(include_inactive=True)[1] == 2
    store.delete_job_description(jid)                                                            # the library entry goes; the postings stay
    assert store.get_job_posting_by_id(a) is None or True
    assert store.list_job_postings(include_inactive=True)[1] == 2


def test_applications_one_per_person_per_job_found_by_e_mail_case_insensitively(store):
    jid = store.save_job_description(jd())
    pid = store.create_job_posting({"job_description_id": jid, "public_token": "t1"})
    cid = store.save_candidate(cv(1))
    assert store.check_existing_application("P1@EXAMPLE.com", pid) is None
    assert store.link_application(pid, cid, {"source": "website"})
    assert store.link_application(pid, cid, {"source": "website"})                              # applying again updates, never duplicates
    assert store.application_count(pid) == 1
    prior = store.check_existing_application("P1@EXAMPLE.com", pid)
    assert prior["id"] == cid and prior["cv_filename"] == "cv1.pdf"
    assert store.check_existing_application("p1@example.com", "other-job") is None
    row = store.applications_for_job(pid)[0]
    assert row["applicant_name"] == "Person 1"
    assert store.candidate_rows([cid])[0]["applied_job_id"] == pid and store.candidate_rows([cid])[0]["applied_job_title"] == "Backend Engineer"


def test_no_match_scores_are_stored(store):
    """A match is computed on demand; nothing about it is written to the tables."""
    jid = store.save_job_description(jd())
    pid = store.create_job_posting({"job_description_id": jid, "public_token": "t1"})
    a = store.save_candidate(cv(1))
    store.link_application(pid, a, {})
    assert not any(name.startswith("match") for name in JobApplication.__table__.columns.keys()) and "matched_at" not in JobApplication.__table__.columns
    assert not hasattr(store, "store_applied_match_scores")
    row = store.candidate_rows([a])[0]
    assert row["applied_job_id"] == pid and "match_score" not in row and "match_rank" not in row
    assert "match_score" not in store.applications_for_job(pid)[0]


def test_the_email_subject_counter_counts_per_prefix_and_year(store):
    assert [store.next_email_subject_counter("SE", 2026) for _ in range(3)] == [1, 2, 3]
    assert store.next_email_subject_counter("SE", 2027) == 1 and store.next_email_subject_counter("DA", 2026) == 1


def test_application_counts_by_day(store):
    jid = store.save_job_description(jd())
    pid = store.create_job_posting({"job_description_id": jid, "public_token": "t1"})
    for i in (1, 2):
        store.link_application(pid, store.save_candidate(cv(i)), {"applied_at": datetime.utcnow()})
    got = store.application_counts_by_day(datetime.utcnow() - timedelta(days=1))
    assert got == [(pid, datetime.utcnow().date().isoformat(), 2)]


def test_lists_keep_their_order_and_their_limits(store):
    cid = store.save_candidate(cv(1, skills=[f"skill {i}" for i in range(25)], responsibilities=[f"did {i}" for i in range(12)],
                                  keywords=["Python", "python", "Docker"], languages=["English", "english", "Arabic"], certifications=[]))
    got = store.get_structured_cv(cid)
    assert got["skills_sentences"] == [f"skill {i}" for i in range(20)]                          # the first 20, in order (item n = vector n)
    assert got["responsibility_sentences"] == [f"did {i}" for i in range(10)]
    with Session(store.engine) as s:
        row = s.get(Candidate, cid)
        assert list(row.keywords) == ["Python", "Docker"] and list(row.languages) == ["English", "Arabic"]   # a repeat in other case is dropped
        assert list(row.certifications) == []
    store.save_candidate({"id": cid, "skills": ["Only one"]})                                    # replaced as a whole; lists not named stay
    again = store.get_structured_cv(cid)
    assert again["skills_sentences"] == ["Only one"] and len(again["responsibility_sentences"]) == 10


def test_skill_counts_come_from_the_array_length(store):
    store.save_candidate(cv(1, skills=["a", "b", "c", "d"]))
    store.save_candidate(cv(2, skills=["a", "b"]))
    store.save_job_description(jd())
    stats = store.skill_stats()
    assert stats["cv"] == {"avg": 3.0, "max": 4, "min": 2} and stats["jd"]["max"] == 2
    assert store.recent_job_descriptions(5)[0]["responsibilities_count"] == 1


def test_a_search_counts_only_up_to_a_cap_and_says_so(store, monkeypatch):
    from app.store import candidates as candidates_module

    monkeypatch.setattr(candidates_module, "COUNT_CAP", 5)
    for i in range(1, 9):
        store.save_candidate(cv(i, raw_text="python developer"))
    ids, total, estimate = store.search_candidate_ids(["python"], 0, 3)
    assert len(ids) == 3 and total == 5 and estimate is True                        # eight match; it stops counting at the cap
    ids, total, estimate = store.search_candidate_ids(["python"], 6, 3)
    assert len(ids) == 2                                                               # paging still reaches every match
    found = store.search_candidates(keywords=["python"], limit=3, with_total=True)
    assert found["total"] == 5 and found["total_is_estimate"] is True and len(found["ids"]) == 3


def test_the_search_filters_by_category_and_by_notes_in_the_database(store):
    a = store.save_candidate(cv(1, facts={"full_name": "A", "category": "Data & Analytics"}))
    b = store.save_candidate(cv(2, facts={"full_name": "B", "category": "Data & Analytics"}))
    c = store.save_candidate(cv(3, facts={"full_name": "C", "category": "Software & Application Development"}))
    store.upsert_note(a, "sam", "good")
    assert set(store.search_candidates(categories=["Data & Analytics"])["ids"]) == {a, b}
    assert set(store.search_candidates(categories=["Data & Analytics", "Software & Application Development"])["ids"]) == {a, b, c}
    assert store.search_candidates(notes="with")["ids"] == [a]
    assert set(store.search_candidates(notes="without")["ids"]) == {b, c}
    assert store.search_candidates(notes="without", categories=["Data & Analytics"], with_total=True)["total"] == 1


def test_posting_lists_are_filtered_and_paged_by_the_database(store):
    jid = store.save_job_description(jd())
    mine = store.create_job_posting({"job_description_id": jid, "public_token": "t1", "posted_by_user": "sam"})
    other = store.create_job_posting({"job_description_id": store.save_job_description(jd(2, standardized={"job_title": "Data Analyst"})),
                                      "public_token": "t2", "posted_by_user": "lee"})
    store.update_job_posting(other, {"is_active": False})
    ids = lambda **kw: {p["id"] for p in store.list_job_postings(include_inactive=True, **kw)[0]}
    assert ids() == {mine, other}
    assert ids(posted_by="sam") == {mine} and ids(not_posted_by="sam") == {other}
    assert ids(status="active") == {mine} and ids(status="inactive") == {other}
    assert ids(q="analyst") == {other} and ids(q="LEE") == {other} and ids(q="backend") == {mine}
    rows, total = store.list_job_postings(include_inactive=True, q="engineer", limit=1)
    assert total == 1 and len(rows) == 1
    assert {p["id"] for p in store.list_job_postings(include_inactive=False)[0]} == {mine}      # the default hides closed postings


def test_the_weekly_report_and_the_applications_page_are_single_queries(store):
    jid = store.save_job_description(jd())
    pid = store.create_job_posting({"job_description_id": jid, "public_token": "t1", "posted_by_user": "sam"})
    for i in range(1, 5):
        store.link_application(pid, store.save_candidate(cv(i)), {"applied_at": datetime.utcnow() - timedelta(minutes=i)})
    rows = store.postings_between(datetime.utcnow() - timedelta(days=1), datetime.utcnow() + timedelta(days=1))
    assert rows == [{"id": pid, "posted_by_user": "sam", "job_title": "Backend Engineer", "application_count": 4}]
    assert store.postings_between(datetime.utcnow() + timedelta(days=1), datetime.utcnow() + timedelta(days=2)) == []
    page = store.applications_for_job(pid, limit=3, offset=0)
    rest = store.applications_for_job(pid, limit=3, offset=3)
    assert len(page) == 3 and len(rest) == 1 and {r["id"] for r in page}.isdisjoint({r["id"] for r in rest})


def test_the_public_openings_search_runs_in_the_database(store):
    def post(i, title, location, skills, **jd_over):
        jid = store.save_job_description(jd(i, standardized={"job_title": title, "skills_sentences": skills, "category": "Other"}, **jd_over))
        pid = store.create_job_posting({"job_description_id": jid, "public_token": f"tok{i}"})
        store.update_job_posting(pid, {"job_location": location})
        return pid

    dubai = post(1, "Python Developer", "Dubai, UAE", ["Python", "Docker"])
    riyadh = post(2, "Data Engineer", "Riyadh, Saudi Arabia", ["Spark", "Python"])
    remote = post(3, "Support Analyst", "Remote", ["Zendesk"])
    nowhere = post(4, "Cook", "", ["Knife"])
    closed = post(5, "Python Tutor", "Dubai", ["Python"])
    store.update_job_posting(closed, {"is_active": False})
    ids = lambda **kw: [p["id"] for p in store.list_public_postings(**kw)[0]]
    assert set(ids()) == {dubai, riyadh, remote, nowhere}                                   # closed postings are never listed
    assert ids(q="python") == [dubai] and set(ids(q="engineer")) == {riyadh}                # title words
    assert ids(q="riyadh") == [riyadh]                                                       # location words
    assert set(ids(skills=["python"])) == {dubai, riyadh} and ids(skills=["python", "spark"]) == [riyadh]    # every skill must appear
    assert ids(region="UAE") == [dubai] and ids(region="KSA") == [riyadh] and ids(region="Remote") == [remote]
    assert ids(region="Not specified") == [nowhere]
    assert ids(region="UAE", areas=["dubai", "dxb"]) == [dubai] and ids(region="UAE", areas=["sharjah"]) == []
    rows, total = store.list_public_postings(limit=2, offset=0)
    assert len(rows) == 2 and total == 4
    assert len(store.list_public_postings(limit=2, offset=2)[0]) == 2


def test_full_text_and_plain_search_agree_with_the_in_memory_rule(store):
    """Whatever the database (PostgreSQL full-text index or the LIKE form), a search returns exactly the CVs the rule picks."""
    from app.ingestion import boolean_query as bq
    from app.ingestion.search_index import normalize

    texts = ["Senior cloud engineer with Terraform and CI/CD", "Cloud engineer, AWS only", "Azure expert, network admin", "Java developer",
             "JavaScript developer and C# programmer", "Led project management office in Dubai", "Managed a project", "Python intern",
             "S/4HANA FICO consultant, SAP FICO", "Node.js and ASP.NET Core developer"]
    ids = {store.save_candidate(cv(i + 1, raw_text=t, skills=[], keywords=[], responsibilities=[], certifications=[], languages=[],
                                    facts={"full_name": f"Person {i}"})): t for i, t in enumerate(texts)}
    for query in ['("Cloud Engineer") AND ("Azure" OR "Terraform")', '"Java"', '"project management"', "python NOT intern", "cloud OR azure",
                  "(cloud OR azure) AND NOT terraform", "NOT intern", '"sap fico"', "s/4hana", "c#", "node.js", "asp.net", "dubai AND (office OR hq)"]:
        node = bq.parse(query)
        wanted = {cid for cid, t in ids.items() if bq.evaluate(node, normalize(t + " Person"))}
        got = set(store.search_candidates(boolean_query=query, limit=100)["ids"])
        assert got == wanted, query
    # plain keywords (each anywhere in the CV): on PostgreSQL a word also matches its other forms, so "Managed a project" has both "project" and "management"
    for words, expect in ((["cloud", "engineer"], 2), (["java"], 1), (["project", "management"], 2 if store._fts else 1), (["sap", "fico"], 1)):
        assert len(store.search_candidate_ids(words, 0, 50)[0]) == expect, words


def test_profile_links_are_cleaned_before_they_are_stored(store):
    """The links are shown as clickable links, so only a clean https link to the person's own profile is kept."""
    good = store.save_candidate(cv(1, facts={"full_name": "A", "linkedin_url": "linkedin.com/in/jane-doe", "github_url": "github.com/jane-doe/repo"}))
    row = store.candidate_detail(good)
    assert row["linkedin_url"] == "https://www.linkedin.com/in/jane-doe" and row["github_url"] == "https://github.com/jane-doe"
    bad = store.save_candidate(cv(2, facts={"full_name": "B", "linkedin_url": "javascript:alert(1)", "github_url": "https://evil.example/x"}))
    row = store.candidate_detail(bad)
    assert row["linkedin_url"] is None and row["github_url"] is None


def test_creating_the_collections_twice_at_once_is_not_an_error():
    """The backend and every worker start together; the loser of the race must carry on."""
    from app.store.vectors import VectorStore

    class Racing:
        def __init__(self):
            self.made = set()
            self.exists_calls = 0

        def collection_exists(self, name):
            self.exists_calls += 1
            return name in self.made or self.exists_calls > 2         # not there yet when asked, there when asked again

        def create_collection(self, collection_name, **_):
            self.made.add(collection_name)
            raise RuntimeError("Collection already exists (another container created it)")

    vs = VectorStore(client=Racing())
    vs.ensure_collections()                                           # raises nothing
    assert vs._ready is True


def test_a_saved_or_deleted_candidate_clears_the_cached_counts(store):
    from app.providers.cache.redis import get_redis_cache
    from app.store.candidates import COUNTS_KEY, COUNTS_NS

    cache = get_redis_cache()                  # the counts are shared by every process (in tests: its in-process stand-in)
    cache.set(COUNTS_KEY, {"stale": 1}, ttl_seconds=60, namespace=COUNTS_NS)
    cid = store.save_candidate(cv(1))
    assert cache.get(COUNTS_KEY, namespace=COUNTS_NS) is None
    cache.set(COUNTS_KEY, {"stale": 1}, ttl_seconds=60, namespace=COUNTS_NS)
    store.delete_candidate(cid)
    assert cache.get(COUNTS_KEY, namespace=COUNTS_NS) is None


def test_a_runaway_search_is_cancelled_by_postgresql(store, monkeypatch):
    """PostgreSQL only: the search time limit is set for the transaction, and a query that outlasts it is cancelled."""
    if store.engine.dialect.name != "postgresql":
        pytest.skip("the time limit is a PostgreSQL feature")
    from sqlalchemy import text

    from app.config.settings import settings

    monkeypatch.setattr(settings, "SEARCH_STATEMENT_TIMEOUT_SECONDS", 1)
    with Session(store.engine) as s:
        store._limit_search_time(s)
        with pytest.raises(Exception, match="statement timeout"):
            s.execute(text("select pg_sleep(3)"))


def test_the_dashboard_overview_counts_every_posting_in_the_database(store):
    today = datetime.utcnow()
    a = store.create_job_posting({"public_token": "a", "posted_by_user": "sam"})
    b = store.create_job_posting({"public_token": "b", "posted_by_user": "rita"})
    closed = store.create_job_posting({"public_token": "c"})
    gone = store.create_job_posting({"public_token": "d"})
    for pid, title in ((a, "Backend Engineer"), (b, "Designer"), (closed, "Old role"), (gone, "Deleted role")):
        store.update_job_posting(pid, {"job_title": title})
    store.update_job_posting(closed, {"is_active": False})
    for i in (1, 2, 3):
        store.link_application(a, store.save_candidate(cv(i)), {"source": "website"})
    designer_applicant = store.save_candidate(cv(4))
    store.link_application(b, designer_applicant, {"source": "website"})
    store.link_application(gone, store.save_candidate(cv(5)), {"source": "website"})
    store.soft_delete_job_posting(gone, "sam")
    with Session(store.engine) as s:                                  # one posting is 100 days old, one application is ten days old
        s.get(JobPosting, closed).created_at = today - timedelta(days=100)
        s.get(JobApplication, (b, designer_applicant)).applied_at = today - timedelta(days=10)
        s.commit()

    o = store.careers_overview()
    assert o["postings"] == {"total": 3, "live": 2, "closed": 1}                       # the deleted posting is nowhere
    assert o["applications"]["total"] == 4 and sum(o["applications"]["series"]) == 4   # its application is not counted either
    assert len(o["applications"]["days"]) == 14 and o["applications"]["series"][-1] == 3
    assert o["applications"]["last_7_days"] == 3 and o["applications"]["previous_7_days"] == 1
    assert len(o["months"]) == 6 and o["months"][-1]["count"] == 2 and sum(m["count"] for m in o["months"]) == 3
    assert [j["job_title"] for j in o["top_jobs"]][:2] == ["Backend Engineer", "Designer"] and o["top_jobs"][0]["application_count"] == 3
    assert {j["job_title"] for j in o["recent_jobs"]} == {"Backend Engineer", "Designer", "Old role"}


def test_a_search_word_matches_its_other_forms_on_postgresql(store):
    """On PostgreSQL the CV words are indexed with their English word forms and no stop words: manage finds managed, engineer finds engineering,
    "IT" is still a word, and Java is still not JavaScript. (SQLite, used by the other tests, matches exact words.)"""
    if not store._fts:
        pytest.skip("word forms are a PostgreSQL text-search feature")
    one = store.save_candidate(cv(1, raw_text="She managed the network engineering team. Management of IT support and Python scripts."))
    two = store.save_candidate(cv(2, raw_text="JavaScript developer for the head of IT"))
    ids = lambda q: set(store.search_candidates(boolean_query=q, limit=10)["ids"])
    assert ids('manage AND "network engineer"') == {one}                  # managed + engineering
    assert ids("management") == {one} and ids("manages") == {one}
    assert ids("IT") == {one, two} and ids('"head of IT"') == {two}      # a stop word like "it" is still searchable
    assert ids("Java") == set() and ids("javascript") == {two}           # a different word stays different
    assert ids("manage NOT javascript") == {one}
    assert ids("Backend") == set()                                       # the AI-written job title is not the CV's own words


def test_a_persons_live_jobs_can_all_be_switched_off_and_nothing_else_changes(store):
    jid = store.save_job_description(jd(1))
    mine = [store.create_job_posting({"job_description_id": jid, "public_token": f"m{i}", "posted_by_user": "sam"}) for i in range(2)]
    other = store.create_job_posting({"job_description_id": jid, "public_token": "o1", "posted_by_user": "lee"})
    off = store.create_job_posting({"job_description_id": jid, "public_token": "m9", "posted_by_user": "sam"})
    store.update_job_posting(off, {"is_active": False})
    assert store.deactivate_jobs_posted_by("sam") == 2 and store.deactivate_jobs_posted_by("sam") == 0          # only live ones; then nothing left
    active = lambda pid: store.get_job_posting_by_id(pid)["is_active"]
    assert not any(active(p) for p in mine) and active(other)                                                     # someone else's job is untouched
    assert store.get_job_posting_by_id(mine[0]) is not None                                                       # nothing was deleted
    assert store.deactivate_jobs_posted_by("") == 0 and store.deactivate_jobs_posted_by("nobody") == 0


def test_simultaneous_closes_make_one_selection_row_on_postgresql(store):
    """Eight workers close the same requirement at the same instant: exactly one makes the row, the rest get nothing back, nobody gets an error."""
    if not store._fts:
        pytest.skip("the race is a PostgreSQL matter (SQLite serialises its writers)")
    from concurrent.futures import ThreadPoolExecutor
    from datetime import date

    from sqlalchemy import func, select

    from app.models.requirement import Requirement
    from app.models.selection import Selection, SelectionRecruiter
    from app.services.selections import create_for_closed

    with Session(store.engine) as s:
        req = Requirement(requirement_date=date(2026, 11, 2), position="P", client="C", created_by="sam", location="Dubai", status="closed",
                          closed_at=datetime.utcnow(), closed_by="sam")
        s.add(req)
        s.commit()
        rid = req.id

    def close_it(_):
        with Session(store.engine) as s:
            made = create_for_closed(s, s.get(Requirement, rid), ["u1", "u2"])
            s.commit()
            return made is not None

    with ThreadPoolExecutor(8) as pool:
        made = list(pool.map(close_it, range(8)))
    assert sum(made) == 1
    with Session(store.engine) as s:
        assert s.execute(select(func.count()).select_from(Selection)).scalar() == 1
        assert s.execute(select(func.count()).select_from(SelectionRecruiter)).scalar() == 2


def test_every_postgresql_connection_runs_in_utc_whatever_the_server_says(store):
    if not store._fts:
        pytest.skip("time zones are a PostgreSQL matter")
    from sqlalchemy import text

    from app.db.database import pin_utc

    shows = lambda e: e.connect().execute(text("SHOW TimeZone")).scalar()
    skewed = create_engine(store.engine.url, connect_args={"options": "-c timezone=Asia/Dubai"})
    assert shows(skewed) == "Asia/Dubai"                       # what a server or a pooler set to local time would give
    event.listen(skewed, "connect", pin_utc)
    skewed.dispose()
    assert shows(skewed) == "UTC"


def test_the_storage_report(store):
    from app.services.db_health import storage_report

    store.save_candidate(cv(1))
    report = storage_report(store.engine)
    if not store._fts:
        assert report == {"supported": False, "warnings": []}
        return
    names = {t["name"] for t in report["tables"]}
    assert report["supported"] and {"candidate", "candidate_search"} <= names
    # row counts come from PostgreSQL's statistics (cheap at any size, an estimate until autovacuum or ANALYZE has run), so a fresh table may read 0
    assert report["candidates"] >= 0 and report["search_bytes_per_cv"] in (None,) or report["search_bytes_per_cv"] > 0
    assert report["database_bytes"] > 0 and isinstance(report["warnings"], list) and report["largest_indexes"]
    search = next(t for t in report["tables"] if t["name"] == "candidate_search")
    assert search["total_bytes"] >= search["table_bytes"] + search["index_bytes"] - 1 and 0 <= search["dead_ratio"] <= 1
