"""A job's boolean string run against the candidate database: people who fit it and have not applied to the job."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import require_core_app
from app.api.routers import careers as C
from tests.test_store import cv, jd, store  # noqa: F401  (the store fixture: SQLite, or PostgreSQL with TEST_STORE_PG_URL)


@pytest.fixture
def world(store, monkeypatch):  # noqa: F811
    jid = store.save_job_description(jd())
    pid = store.create_job_posting({"job_description_id": jid, "public_token": "cloud-1", "posted_by_user": "sam"})
    store.update_job_posting(pid, {"boolean_search_string": '("Cloud Engineer") AND ("Azure" OR "Terraform")'})
    applied = store.save_candidate(cv(1, raw_text="cloud engineer with azure, applied through the site"))
    store.link_application(pid, applied, {"source": "website"})
    fits = [store.save_candidate(cv(i, raw_text=f"senior cloud engineer {i} with terraform")) for i in (2, 3, 4)]
    other = store.save_candidate(cv(5, raw_text="accountant with excel"))
    monkeypatch.setattr(C, "get_store", lambda: store)
    app = FastAPI()
    app.include_router(C.router, prefix="/api/careers")
    app.dependency_overrides[require_core_app] = lambda: SimpleNamespace(username="rita", role="user")
    return SimpleNamespace(client=TestClient(app), store=store, pid=pid, applied=applied, fits=fits, other=other)


def url(w, **params):
    return w.client.get(f"/api/careers/admin/jobs/{w.pid}/database-candidates", params=params)


def test_search_can_leave_candidates_out(world):
    got = world.store.search_candidates(boolean_query="cloud", with_total=True, exclude_ids=[world.applied])
    assert set(got["ids"]) == set(world.fits) and got["total"] == 3
    assert world.store.applicant_ids(world.pid) == [world.applied]


def test_database_candidates_fit_the_jobs_string_and_exclude_its_applicants(world):
    r = url(world)
    assert r.status_code == 200
    body = r.json()
    assert {c["id"] for c in body["results"]} == set(world.fits)            # not the applicant, not the accountant
    assert body["total"] == 3 and body["applicants_excluded"] == 1 and body["query_source"] == "job"
    assert body["boolean_query"].startswith('("Cloud Engineer")')
    assert "Terraform" in body["results"][0]["matched_keywords"]


def test_pages_with_a_cursor_and_lists_every_id_for_matching(world):
    first = url(world, limit=2).json()
    assert len(first["results"]) == 2 and first["next_cursor"]
    second = url(world, limit=2, cursor=first["next_cursor"]).json()
    assert {c["id"] for c in first["results"] + second["results"]} == set(world.fits) and second["next_cursor"] is None
    ids = url(world, ids_only=True).json()
    assert set(ids["ids"]) == set(world.fits) and ids["total"] == 3 and ids["truncated"] is False


def test_a_typed_string_replaces_the_jobs_own_for_this_view(world):
    body = url(world, q="accountant AND excel").json()
    assert [c["id"] for c in body["results"]] == [world.other] and body["query_source"] == "custom"
    r = url(world, q='("unbalanced')
    assert r.status_code == 400 and "boolean" in r.json()["detail"].lower()


def test_a_job_without_a_string_gets_one_from_its_title(world):
    query, source = C._job_boolean_query({"job_title": "Cloud Engineer", "qualifications": "Azure\nTerraform","boolean_search_string": ""}, None)
    assert source == "generated" and query.startswith('("Cloud Engineer")') and "Azure" in query
    assert C._job_boolean_query({"job_title": "", "qualifications": ""}, None) == ("", "generated")
    assert world.client.get("/api/careers/admin/jobs/nope/database-candidates").status_code == 404
