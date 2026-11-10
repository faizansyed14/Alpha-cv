"""Bug reports: anyone signed in reports and follows their own; only the admin sees all, changes status, answers and deletes."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel

from app.api.deps import require_admin, require_user
from app.api.routers import bug_reports as B
from app.db.database import get_session
from app.models.bug_report import BugReport
from fastapi import HTTPException

GOOD = {"title": "Match page freezes", "description": "After I press Match the spinner never stops.", "area": "Match", "severity": "high"}


@pytest.fixture
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[BugReport.__table__])
    session = Session(engine)
    people = {
        "rita": SimpleNamespace(username="rita", role="user", email="rita@example.com"),
        "sam": SimpleNamespace(username="sam", role="evp", email=None),
        "root": SimpleNamespace(username="root", role="admin", email=None),
        "ahmed": SimpleNamespace(username="ahmed", role="account_manager", email=None),
    }
    current = {"user": people["rita"]}

    def admin_only():
        if current["user"].role != "admin":
            raise HTTPException(status_code=403, detail="Admin only")
        return current["user"]

    app = FastAPI()
    app.include_router(B.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[require_user] = lambda: current["user"]
    app.dependency_overrides[require_admin] = admin_only
    yield SimpleNamespace(client=TestClient(app), session=session, people=people, current=current)
    session.close()


def as_(world, name):
    world.current["user"] = world.people[name]


def test_every_role_can_report_and_the_reporter_comes_from_the_sign_in(world):
    for name in ("rita", "sam", "root", "ahmed"):
        as_(world, name)
        r = world.client.post("/api/bugs", json={**GOOD, "title": f"Bug from {name}", "reporter_username": "someone-else"},
                              headers={"user-agent": "TestBrowser/1.0"})
        assert r.status_code == 201, (name, r.text)
        assert r.json()["status"] == "open"
    rows = world.session.query(BugReport).all()
    assert sorted(r.reporter_username for r in rows) == ["ahmed", "rita", "root", "sam"]
    rita = next(r for r in rows if r.reporter_username == "rita")
    assert rita.reporter_role == "user" and rita.reporter_email == "rita@example.com" and rita.user_agent == "TestBrowser/1.0"


def test_a_report_must_say_something_and_use_known_values(world):
    for bad in ({**GOOD, "title": "x"}, {**GOOD, "description": "too short"}, {**GOOD, "area": "Mars"}, {**GOOD, "severity": "apocalyptic"},
                {**GOOD, "title": "x" * 161}, {**GOOD, "description": "x" * 4001}):
        assert world.client.post("/api/bugs", json=bad).status_code == 422, bad
    assert world.session.query(BugReport).count() == 0


def test_control_characters_are_stripped_and_text_is_stored_as_text(world):
    r = world.client.post("/api/bugs", json={**GOOD, "title": "Broken \x00page <script>alert(1)</script>"})
    assert r.status_code == 201
    assert "\x00" not in r.json()["title"] and "<script>" in r.json()["title"]       # never executed: the page shows it as plain text


def test_a_person_cannot_flood_the_list(world):
    for _ in range(B.MAX_REPORTS_PER_HOUR):
        assert world.client.post("/api/bugs", json=GOOD).status_code == 201
    assert world.client.post("/api/bugs", json=GOOD).status_code == 429
    as_(world, "sam")                                                                # the limit is per person
    assert world.client.post("/api/bugs", json=GOOD).status_code == 201


def test_everyone_sees_only_their_own_reports_and_the_admins_answer(world):
    world.client.post("/api/bugs", json={**GOOD, "title": "Rita's bug"})
    as_(world, "sam")
    world.client.post("/api/bugs", json={**GOOD, "title": "Sam's bug"})
    mine = world.client.get("/api/bugs/mine").json()
    assert mine["total"] == 1 and mine["items"][0]["title"] == "Sam's bug"
    assert "reporter_username" not in mine["items"][0] and "user_agent" not in mine["items"][0]
    bug_id = mine["items"][0]["id"]
    as_(world, "root")
    assert world.client.patch(f"/api/admin/bugs/{bug_id}", json={"status": "resolved", "admin_note": "Fixed in the next release"}).status_code == 200
    as_(world, "sam")
    seen = world.client.get("/api/bugs/mine").json()["items"][0]
    assert seen["status"] == "resolved" and seen["admin_note"] == "Fixed in the next release" and seen["resolved_at"]


def test_only_the_admin_reaches_the_admin_routes(world):
    world.client.post("/api/bugs", json=GOOD)
    bug_id = world.session.query(BugReport).one().id
    for method, path, body in (("get", "/api/admin/bugs", None), ("get", "/api/admin/bugs/open-count", None),
                               ("patch", f"/api/admin/bugs/{bug_id}", {"status": "closed"}), ("delete", f"/api/admin/bugs/{bug_id}", None)):
        for name in ("rita", "sam", "ahmed"):
            as_(world, name)
            r = world.client.request(method, path, json=body)
            assert r.status_code == 403, (method, path, name)
    assert world.session.query(BugReport).one().status == "open"


def test_the_admin_list_pages_filters_searches_and_counts(world):
    for i in range(5):
        as_(world, "rita" if i % 2 == 0 else "sam")
        world.client.post("/api/bugs", json={**GOOD, "title": f"Bug number {i}", "severity": "low" if i == 4 else "high",
                                             "description": "The upload button does nothing" if i == 3 else GOOD["description"]})
    as_(world, "root")
    ids = [b["id"] for b in world.client.get("/api/admin/bugs").json()["items"]]
    world.client.patch(f"/api/admin/bugs/{ids[0]}", json={"status": "in_progress"})
    world.client.patch(f"/api/admin/bugs/{ids[1]}", json={"status": "resolved"})

    everything = world.client.get("/api/admin/bugs").json()
    assert everything["total"] == 5 and everything["counts"] == {"all": 5, "open": 3, "in_progress": 1, "resolved": 1, "closed": 0}
    page = world.client.get("/api/admin/bugs", params={"limit": 2, "offset": 2}).json()
    assert len(page["items"]) == 2 and page["total"] == 5
    only_open = world.client.get("/api/admin/bugs", params={"status": "open"}).json()
    assert only_open["total"] == 3 and all(b["status"] == "open" for b in only_open["items"])
    assert only_open["counts"]["all"] == 5                                             # the tabs keep their numbers
    assert world.client.get("/api/admin/bugs", params={"q": "UPLOAD button"}).json()["total"] == 1       # description, any case
    assert world.client.get("/api/admin/bugs", params={"q": "sam"}).json()["total"] == 2                  # reporter
    low = world.client.get("/api/admin/bugs", params={"severity": "low"}).json()
    assert low["total"] == 1 and low["counts"]["all"] == 1
    assert world.client.get("/api/admin/bugs/open-count").json() == {"open": 3}
    first = world.client.get("/api/admin/bugs").json()["items"][0]
    assert first["reporter_username"] in ("rita", "sam") and "user_agent" in first and "page_url" not in first


def test_status_changes_are_tracked_and_notes_can_be_cleared(world):
    world.client.post("/api/bugs", json=GOOD)
    bug_id = world.session.query(BugReport).one().id
    as_(world, "root")
    r = world.client.patch(f"/api/admin/bugs/{bug_id}", json={"status": "closed", "severity": "low", "admin_note": "Cannot reproduce"}).json()
    assert r["status"] == "closed" and r["severity"] == "low" and r["handled_by"] == "root" and r["resolved_at"]
    r = world.client.patch(f"/api/admin/bugs/{bug_id}", json={"status": "open", "admin_note": ""}).json()
    assert r["status"] == "open" and r["resolved_at"] is None and r["admin_note"] is None
    assert world.client.patch(f"/api/admin/bugs/{bug_id}", json={"status": "bogus"}).status_code == 422
    assert world.client.patch("/api/admin/bugs/missing", json={"status": "closed"}).status_code == 404


def test_the_admin_can_delete_a_report(world):
    world.client.post("/api/bugs", json=GOOD)
    bug_id = world.session.query(BugReport).one().id
    as_(world, "root")
    assert world.client.delete(f"/api/admin/bugs/{bug_id}").status_code == 204
    assert world.client.delete(f"/api/admin/bugs/{bug_id}").status_code == 404
    assert world.session.query(BugReport).count() == 0
