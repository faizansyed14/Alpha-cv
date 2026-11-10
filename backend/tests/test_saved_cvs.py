"""Saved CVs over HTTP: every recruiter has their own list; the page reads it paged and searched, in the Candidates list's shape."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from qdrant_client import QdrantClient
from sqlalchemy import create_engine, event
from sqlmodel import SQLModel

from app.api.deps import require_core_app
from app.api.routers import cvs as C
from app.store import TalentStore
from app.store.vectors import VectorStore
from test_store import cv


@pytest.fixture
def world(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'saved.db'}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _fk(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    SQLModel.metadata.create_all(engine)
    store = TalentStore(engine=engine, vectors=VectorStore(client=QdrantClient(":memory:")))
    monkeypatch.setattr(C, "get_store", lambda: store)
    current = {"user": SimpleNamespace(username="rita", role="user")}
    app = FastAPI()
    app.include_router(C.router, prefix="/api/cv")
    app.dependency_overrides[require_core_app] = lambda: current["user"]
    ids = [store.save_candidate(cv(i, raw_text=f"{name} developer who writes {lang}", full_name=name, skills=[f"{name} work"], keywords=[name]))
           for i, (name, lang) in enumerate((("Alpha", "Python"), ("Beta", "Java"), ("Gamma", "Python")), start=1)]
    yield SimpleNamespace(client=TestClient(app), store=store, ids=ids, current=current)


def as_(world, name, role="user"):
    world.current["user"] = SimpleNamespace(username=name, role=role)


def test_save_list_and_remove_over_http(world):
    a, b, c = world.ids
    assert world.client.post("/api/cv/saved", json={"cv_ids": [a, b, "missing"]}).json()["saved"] == 2
    assert world.client.post("/api/cv/saved", json={"cv_ids": [a]}).json()["saved"] == 0                  # already saved
    assert set(world.client.get("/api/cv/saved/ids").json()["ids"]) == {a, b}
    page = world.client.get("/api/cv/saved").json()
    assert page["total"] == 2 and page["count"] == 2 and {r["id"] for r in page["cvs"]} == {a, b}
    assert {"full_name", "job_title", "skills", "email", "years_of_experience"} <= set(page["cvs"][0])      # the Candidates list's shape
    assert world.client.post("/api/cv/saved/remove", json={"cv_ids": [a]}).json()["removed"] == 1
    assert world.client.get("/api/cv/saved/ids").json()["ids"] == [b]
    assert world.store.candidate_detail(a) is not None                                                   # the CV itself stays


def test_each_person_has_their_own_list(world):
    a, b, c = world.ids
    world.client.post("/api/cv/saved", json={"cv_ids": [a]})
    as_(world, "sam", "manager")
    world.client.post("/api/cv/saved", json={"cv_ids": [c]})
    assert world.client.get("/api/cv/saved/ids").json()["ids"] == [c]
    assert [r["id"] for r in world.client.get("/api/cv/saved").json()["cvs"]] == [c]
    world.client.post("/api/cv/saved/remove", json={"cv_ids": [a]})                                        # sam cannot touch rita's save
    as_(world, "rita")
    assert world.client.get("/api/cv/saved/ids").json()["ids"] == [a]


def test_the_saved_list_is_paged_and_searched_by_the_database(world):
    a, b, c = world.ids
    world.client.post("/api/cv/saved", json={"cv_ids": [a, b, c]})
    first = world.client.get("/api/cv/saved", params={"limit": 2}).json()
    assert first["total"] == 3 and first["count"] == 2
    rest = world.client.get("/api/cv/saved", params={"limit": 2, "offset": 2}).json()
    assert rest["count"] == 1 and {r["id"] for r in first["cvs"]} | {r["id"] for r in rest["cvs"]} == {a, b, c}
    hit = world.client.get("/api/cv/saved", params={"q": "python"}).json()
    assert hit["total"] == 2 and {r["id"] for r in hit["cvs"]} == {a, c}
    assert world.client.get("/api/cv/saved", params={"q": "rust"}).json()["total"] == 0
    assert world.client.get("/api/cv/saved", params={"limit": 0}).status_code == 422


def test_the_request_body_is_checked(world):
    assert world.client.post("/api/cv/saved", json={"cv_ids": []}).status_code == 422
    assert world.client.post("/api/cv/saved", json={}).status_code == 422
    assert world.client.post("/api/cv/saved", json={"cv_ids": ["x"] * 501}).status_code == 422
    assert world.client.post("/api/cv/saved/remove", json={"cv_ids": []}).status_code == 422


def test_the_saved_routes_are_not_taken_for_a_cv_id(world):
    """/saved must not be read as /{cv_id}."""
    assert world.client.get("/api/cv/saved").status_code == 200 and world.client.get("/api/cv/saved/ids").status_code == 200
