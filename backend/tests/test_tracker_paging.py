"""The tracker's paged lists: the database searches, filters, orders and pages every row; the card numbers are counted over every row."""
import os
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session

from app.api.routers import tracker as T
from app.models.tracker import models as M
from app.models.tracker.base import TrackerSQLModel

TODAY = date.today()


@pytest.fixture
def world():
    # SQLite by default; TEST_STORE_PG_URL (a THROWAWAY PostgreSQL database: its tracker tables are dropped) runs the same tests on PostgreSQL
    pg = os.environ.get("TEST_STORE_PG_URL")
    if pg:
        engine = create_engine(pg)
        TrackerSQLModel.metadata.drop_all(engine)
    else:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TrackerSQLModel.metadata.create_all(engine)
    session = Session(engine)
    user = SimpleNamespace(role="admin", username="root", team_location="Dubai")

    app = FastAPI()
    app.include_router(T.router)
    app.dependency_overrides[T.tracker_session] = lambda: session
    for name in dir(T):                      # every role gate of the tracker router (read, write, admin ...) answers with the test user
        gate = getattr(T, name)
        if name.startswith("Allowed") and hasattr(gate, "dependency"):
            app.dependency_overrides[gate.dependency] = lambda: user
    yield SimpleNamespace(client=TestClient(app), session=session, user=user)
    session.rollback()
    session.close()          # a PostgreSQL test must not leave its transaction open for the next test's DROP TABLE
    engine.dispose()


def seed(world):
    s = world.session
    t0 = datetime(2026, 1, 1)
    # job openings: 5 in Dubai, 2 in Abu Dhabi
    for i, (title, status) in enumerate([("Java Dev", "Open"), ("Cloud Architect", "Hold"), ("SAP Lead", "Closed"), ("Data Analyst", "Submitted"),
                                         ("Java Tester", "Open")]):
        s.add(M.TrackerJobOpening(team="dubai", title=title, status=status, client="Acme", created_at=t0 + timedelta(days=i), submission_date=TODAY - timedelta(days=i)))
    for i, title in enumerate(["AD Java", "AD Nurse"]):
        s.add(M.TrackerJobOpening(team="abudhabi", title=title, status="Open", created_at=t0 + timedelta(days=10 + i)))
    s.add(M.TrackerJobOpening(team="dubai", title="Deleted one", status="Open", is_deleted=True))
    # candidates with applications: the latest application decides the row
    for i, (name, status, team_loc) in enumerate([("Asha", "Joined", "Dubai"), ("Bilal", "Offer Pending", "Dubai"), ("Chen", "Backed out", "Dubai"),
                                                  ("Dina", "Offer Released", "Dubai"), ("Eli", "Joined Pending", "Dubai"), ("Fay", "Joined", "Abu Dhabi")]):
        c = M.TrackerCandidate(team="dubai", name=name, created_at=t0 + timedelta(days=i))
        s.add(c)
        s.flush()
        s.add(M.TrackerApplication(team="dubai", candidate_id=c.id, status="Screening", created_at=t0, applied_date=TODAY - timedelta(days=30),
                                   created_by_team_location=team_loc))
        s.add(M.TrackerApplication(team="dubai", candidate_id=c.id, status=status, position=f"Role {name}", client="Acme", applied_date=TODAY - timedelta(days=i),
                                   created_at=t0 + timedelta(days=1), created_by_team_location=team_loc))
    s.add(M.TrackerCandidate(team="dubai", name="No application"))                           # shown to admins, hidden from restricted roles
    # follow-ups
    for i, (client, stage, nxt) in enumerate([("Acme", "Feedback Pending", TODAY - timedelta(days=3)), ("Beta", "Hold", TODAY + timedelta(days=2)),
                                              ("Gamma", "Positions Closed", TODAY - timedelta(days=9)), ("Delta", "Interview Scheduled", TODAY + timedelta(days=1)),
                                              ("Acme", "Feedback Pending", None)]):
        s.add(M.TrackerFollowUp(team="dubai", client_name=client, current_stage=stage, next_follow_up_date=nxt, created_at=t0 + timedelta(days=i), remarks="call back"))
    s.add(M.TrackerFollowUp(team="abudhabi", client_name="AD client", current_stage="Hold", created_at=t0 + timedelta(days=20)))
    s.commit()


def get(world, path, **params):
    r = world.client.get(f"/api/tracker/{path}", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_job_openings_are_searched_filtered_and_paged_by_the_database(world):
    seed(world)
    page = get(world, "job-openings/page", team="dubai", limit=2, offset=0)
    assert page["total"] == 5 and [j["title"] for j in page["items"]] == ["Java Tester", "Data Analyst"]      # newest first, deleted ones never
    assert [j["title"] for j in get(world, "job-openings/page", team="dubai", limit=2, offset=4)["items"]] == ["Java Dev"]
    assert get(world, "job-openings/page", team="dubai", q="java")["total"] == 2
    assert get(world, "job-openings/page", team="dubai", status="Hold")["total"] == 1
    assert get(world, "job-openings/page", team="dubai", date_from=str(TODAY - timedelta(days=1)))["total"] == 2   # submission date range
    assert get(world, "job-openings/page", team="dubai", q="java", status="Open", limit=1)["total"] == 2
    assert world.client.get("/api/tracker/job-openings/page", params={"date_from": "bad"}).status_code == 400


def test_both_teams_listed_together_are_merged_in_order(world):
    seed(world)
    both = get(world, "job-openings/page", team="all", limit=3, offset=0)
    assert both["total"] == 7
    assert [(j["title"], j["team"]) for j in both["items"]] == [("AD Nurse", "abudhabi"), ("AD Java", "abudhabi"), ("Java Tester", "dubai")]
    nxt = get(world, "job-openings/page", team="all", limit=3, offset=3)
    assert [j["title"] for j in nxt["items"]] == ["Data Analyst", "SAP Lead", "Cloud Architect"]
    world.user.role = "manager"
    assert world.client.get("/api/tracker/job-openings/page", params={"team": "all"}).status_code == 403    # only admins list both teams


def test_candidate_rows_show_the_latest_application_and_search_every_column(world):
    seed(world)
    page = get(world, "candidate-rows/page", team="dubai", limit=3, offset=0)
    assert page["total"] == 7                                                       # six with applications and the one without
    assert [r["candidate"]["name"] for r in page["items"]] == ["Asha", "Bilal", "Chen"]                       # latest applied date first
    assert page["items"][0]["application"]["status"] == "Joined"                    # the later application, not "Screening"
    assert get(world, "candidate-rows/page", team="dubai", sort="oldest", limit=1)["items"][0]["candidate"]["name"] == "No application"
    assert get(world, "candidate-rows/page", team="dubai", q="role dina")["total"] == 1            # position text
    assert get(world, "candidate-rows/page", team="dubai", status="Offer Pending")["total"] == 1
    assert get(world, "candidate-rows/page", team="dubai", date_from=str(TODAY - timedelta(days=1)))["total"] == 2
    rest = get(world, "candidate-rows/page", team="dubai", limit=3, offset=3)
    assert [r["candidate"]["name"] for r in rest["items"]] == ["Dina", "Eli", "Fay"] and rest["total"] == 7


def test_a_restricted_role_sees_only_its_own_teams_applications(world):
    seed(world)
    world.user.role, world.user.team_location = "recruiter", "Abu Dhabi"
    names = [r["candidate"]["name"] for r in get(world, "candidate-rows/page", team="dubai")["items"]]
    assert names == []                                                              # a restricted user reads only their own team's tables (Abu Dhabi's are empty here)
    world.user.team_location = "Dubai"
    page = get(world, "candidate-rows/page", team="dubai", limit=50)
    assert page["total"] == 5 and not {"No application", "Fay"} & {r["candidate"]["name"] for r in page["items"]}
    assert get(world, "summary")["selections"]["total"] == 5


def test_follow_ups_are_searched_and_paged(world):
    seed(world)
    page = get(world, "follow-ups/page", team="dubai", limit=2)
    assert page["total"] == 5 and len(page["items"]) == 2 and page["items"][0]["client_name"] == "Acme"        # newest first
    assert get(world, "follow-ups/page", team="dubai", q="gamma")["total"] == 1
    assert get(world, "follow-ups/page", team="dubai", q="call back")["total"] == 5                      # remarks are searched too
    assert get(world, "follow-ups/page", team="dubai", stage="Feedback Pending")["total"] == 2
    assert get(world, "follow-ups/page", team="dubai", date_from=str(TODAY), date_to=str(TODAY + timedelta(days=5)))["total"] == 2


def test_the_card_numbers_are_counted_over_every_row(world):
    seed(world)
    s = get(world, "summary", team="dubai")
    assert s["requirements"] == {"total": 5, "open": 2, "submitted": 1, "hold": 1, "closed": 1}
    assert s["selections"] == {"total": 7, "joined": 2, "backouts": 1, "offerReleased": 1, "offerPending": 1}    # "Joined Pending" is not joined
    assert s["followups"] == {"total": 5, "feedbackPending": 2, "positionsClosed": 1, "overdue": 1, "hold": 1, "interviewScheduled": 1}
    both = get(world, "summary", team="all")
    assert both["requirements"]["total"] == 7 and both["followups"]["total"] == 6 and both["selections"]["total"] == 7


# ---------------------------------------------------------------------------------------------------- one set of tables, two teams
def test_a_request_sees_and_changes_only_its_own_teams_rows(world):
    """Both teams share the tracker tables; the request's team limits every query and stamps every new row."""
    seed(world)
    dxb = world.client.get("/api/tracker/job-openings", params={"team": "dubai"}).json()
    abu = world.client.get("/api/tracker/job-openings", params={"team": "abudhabi"}).json()
    assert {j["title"] for j in abu} == {"AD Java", "AD Nurse"} and "AD Java" not in {j["title"] for j in dxb} and len(dxb) == 5

    created = world.client.post("/api/tracker/job-openings", params={"team": "abudhabi"}, json={"title": "AD New", "status": "Open"})
    assert created.status_code in (200, 201), created.text
    titles_abu = {j["title"] for j in world.client.get("/api/tracker/job-openings", params={"team": "abudhabi"}).json()}
    titles_dxb = {j["title"] for j in world.client.get("/api/tracker/job-openings", params={"team": "dubai"}).json()}
    assert "AD New" in titles_abu and "AD New" not in titles_dxb                     # stamped with the team it was created for

    other_teams_id = next(j["id"] for j in abu if j["title"] == "AD Java")
    assert world.client.patch(f"/api/tracker/job-openings/{other_teams_id}", params={"team": "dubai"}, json={"status": "Closed"}).status_code == 404
    assert world.client.patch(f"/api/tracker/job-openings/{other_teams_id}", params={"team": "abudhabi"}, json={"status": "Closed"}).status_code == 200


def test_clearing_one_team_leaves_the_other(world):
    seed(world)
    r = world.client.post("/api/tracker/admin/clear-team", params={"team": "abudhabi", "confirm": "CLEAR"})
    assert r.status_code == 200, r.text
    assert get(world, "job-openings/page", team="abudhabi")["total"] == 0
    assert get(world, "job-openings/page", team="dubai")["total"] == 5
    assert get(world, "follow-ups/page", team="abudhabi")["total"] == 0 and get(world, "follow-ups/page", team="dubai")["total"] == 5
