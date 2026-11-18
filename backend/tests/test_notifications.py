"""The bell: who is notified of what, the unread count going down when a notification is opened, nobody seeing another's notifications,
nothing older than 30 days, and a notification never breaking the change it reports."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, select

from app.api.deps import require_admin, require_core_app, require_user
from app.api.routers import bug_reports as B
from app.api.routers import notifications as N
from app.api.routers import tracker as T
from app.config.settings import settings
from app.db.database import get_session
from app.models.bug_report import BugReport
from app.models.notification import Notification
from app.models.requirement import Requirement, RequirementEvent, RequirementRecruiter
from app.models.selection import Selection, SelectionRecruiter
from app.models.user import User
from app.security.auth import hash_password
from app.services import notifications as svc


@pytest.fixture
def world(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[User.__table__, Requirement.__table__, RequirementEvent.__table__, RequirementRecruiter.__table__,
                                                  Selection.__table__, SelectionRecruiter.__table__, BugReport.__table__, Notification.__table__])
    session = Session(engine)

    def add(username, role, location=None, active=True):
        u = User(username=username, password_hash=hash_password("x"), role=role, is_active=active, location=location, email=f"{username}@example.com")
        session.add(u)
        session.commit()
        session.refresh(u)
        return u

    w = SimpleNamespace(session=session, engine=engine,
                        sales=add("sam", "account_manager", "Dubai"), mgr=add("mona", "manager", "Dubai"), mgr2=add("mike", "manager", "Dubai"),
                        rita=add("rita", "user", "Dubai"), rob=add("rob", "user", "Dubai"), gone=add("gone", "user", "Dubai", active=False),
                        admin=add("root", "admin"), admin2=add("root2", "admin"), evp=add("eve", "evp"), evp_gone=add("old_evp", "evp", active=False))
    caller = {"user": w.sales}
    monkeypatch.setattr(T, "get_store", lambda: SimpleNamespace(jd_document=lambda _id: None))
    app = FastAPI()
    for r in (T.router, B.router, N.router):
        app.include_router(r)
    app.dependency_overrides[get_session] = lambda: session
    for dep in (require_core_app, require_user, require_admin):
        app.dependency_overrides[dep] = lambda: caller["user"]
    w.client, w.as_ = TestClient(app), (lambda u: caller.update(user=u))
    yield w
    session.close()


def requirement(world, **kw):
    body = {"requirement_date": "2026-11-02", "position": "Network Engineer", "client": "Acme", **kw}
    r = world.client.post("/api/tracker/requirements", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def bell(world, who):
    world.as_(who)
    return world.client.get("/api/notifications").json()


def count(world, who):
    world.as_(who)
    return world.client.get("/api/notifications/unread-count").json()["unread"]


# ------------------------------------------------------------------------------------------------------------- requirements
def test_everyone_put_on_a_new_requirement_is_told_but_not_the_person_who_added_it(world):
    r = requirement(world, recruiter_ids=[world.rita.id, world.rob.id], manager_id=world.mgr.id)
    for who in (world.rita, world.rob, world.mgr):
        items = bell(world, who)["items"]
        assert len(items) == 1 and items[0]["kind"] == "requirement_assigned" and items[0]["link"] == f"/tracker?focus={r['id']}"
        assert "Network Engineer" in items[0]["title"] and "Acme" in items[0]["body"] and items[0]["read"] is False
    assert bell(world, world.sales)["items"] == []
    assert count(world, world.mgr2) == 0                                                  # not on it: not told


def test_a_change_tells_only_the_people_newly_put_on_it(world):
    world.as_(world.sales)
    r = requirement(world, recruiter_ids=[world.rita.id])
    world.as_(world.sales)
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"recruiter_ids": [world.rita.id, world.rob.id], "manager_id": world.mgr2.id})
    assert count(world, world.rita) == 1                                                  # only the first time
    assert count(world, world.rob) == 1 and count(world, world.mgr2) == 1
    world.as_(world.sales)
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"position": "Senior Network Engineer"})   # nobody new: nobody told
    assert count(world, world.rob) == 1


def test_a_requirement_added_already_closed_or_to_a_deactivated_person_tells_nobody(world):
    world.as_(world.mgr2)                                                                 # a sales manager cannot set the status
    requirement(world, recruiter_ids=[world.rita.id], status="closed")
    assert count(world, world.rita) == 0
    assert svc.notify(world.session, [world.gone.id], "requirement_assigned", "t") == 0  # an inactive account is never told


def test_a_failed_notification_never_undoes_the_change(world, monkeypatch):
    def broken(**_kw):
        raise RuntimeError("database hiccup")

    monkeypatch.setattr(svc, "Notification", broken)
    r = requirement(world, recruiter_ids=[world.rita.id])
    assert world.session.get(Requirement, r["id"]) is not None                            # the requirement is saved
    monkeypatch.undo()
    assert count(world, world.rita) == 0


def test_closing_tells_the_recruiters_the_managers_and_the_evps_but_not_the_closer(world):
    r = requirement(world, recruiter_ids=[world.rob.id, world.rita.id], manager_id=world.mgr.id)
    world.as_(world.rita)
    world.client.post("/api/notifications/read-all")
    for who in (world.rob, world.mgr):
        world.as_(who)
        world.client.post("/api/notifications/read-all")                                 # start from zero (they were told of the assignment)
    world.as_(world.rita)                                                                 # rita (not the first assigned) closes it
    assert world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "closed"}).status_code == 200
    closed = lambda who: [i for i in bell(world, who)["items"] if i["kind"] == "requirement_closed"]
    for who in (world.mgr, world.sales, world.evp):
        [n] = closed(who)
        assert n["title"] == "Requirement closed: Network Engineer" and "closed by rita" in n["body"]
        assert n["link"] == f"/tracker/closures?focus={r['id']}" and n["read"] is False
    [rob] = closed(world.rob)                                                             # the other recruiter: told, nothing to open
    assert rob["link"] is None
    assert closed(world.rita) == []                                                       # not the person who closed it
    assert count(world, world.mgr2) == 0 and closed(world.admin) == []                    # not on it, not an EVP
    assert world.session.exec(select(Notification).where(Notification.user_id == world.evp_gone.id)).all() == []


def test_a_manager_closing_it_sends_the_credited_recruiter_to_closures(world):
    r = requirement(world, recruiter_ids=[world.rita.id], manager_id=world.mgr.id)
    world.as_(world.mgr)
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "closed"})
    [n] = [i for i in bell(world, world.rita)["items"] if i["kind"] == "requirement_closed"]
    assert n["link"] == f"/tracker/closures?focus={r['id']}" and "closed by mona" in n["body"]
    assert [i for i in bell(world, world.mgr)["items"] if i["kind"] == "requirement_closed"] == []   # mona closed it herself
    world.as_(world.mgr)                                                                  # reopening and closing again tells them again
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "open"})
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "closed"})
    assert len([i for i in bell(world, world.evp)["items"] if i["kind"] == "requirement_closed"]) == 2


def test_a_recruiter_changing_the_status_tells_its_managers(world):
    r = requirement(world, recruiter_ids=[world.rita.id], manager_id=world.mgr.id)
    status = lambda who: [i for i in bell(world, who)["items"] if i["kind"] == "requirement_status"]
    world.as_(world.rita)
    assert world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "hold"}).status_code == 200
    for who in (world.mgr, world.sales):
        [n] = status(who)
        assert n["title"] == "Network Engineer is now On hold" and "Open → On hold" in n["body"] and "by rita" in n["body"]
        assert n["link"] == f"/tracker?focus={r['id']}" and n["read"] is False
    assert status(world.rita) == [] and status(world.evp) == [] and status(world.mgr2) == []   # not the changer, not off the requirement
    world.as_(world.rita)                                                                 # a save that leaves the status as it was says nothing
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "hold", "recruiter_comments": "waiting on client"})
    assert len(status(world.mgr)) == 1
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "closed"})   # closing has its own notice, not this one
    assert len(status(world.mgr)) == 1
    world.as_(world.rita)
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "open"})     # a reopen is told as one
    assert status(world.mgr)[0]["title"] == "Requirement reopened: Network Engineer"


def test_a_manager_changing_the_status_is_not_told_of_it_themselves(world):
    r = requirement(world, recruiter_ids=[world.rita.id], manager_id=world.mgr.id)
    world.as_(world.mgr)
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "submitted"})
    assert [i for i in bell(world, world.mgr)["items"] if i["kind"] == "requirement_status"] == []
    assert len([i for i in bell(world, world.sales)["items"] if i["kind"] == "requirement_status"]) == 1


# ------------------------------------------------------------------------------------------------------------- reading them
def test_opening_one_takes_the_count_down_and_read_all_takes_it_to_zero(world):
    for n in range(3):
        requirement(world, recruiter_ids=[world.rita.id], position=f"Role {n}")
    assert count(world, world.rita) == 3
    first = bell(world, world.rita)["items"][0]
    world.as_(world.rita)
    assert world.client.post(f"/api/notifications/{first['id']}/read").json() == {"unread": 2}
    assert world.client.post(f"/api/notifications/{first['id']}/read").json() == {"unread": 2}   # opening it again changes nothing
    assert [i["read"] for i in bell(world, world.rita)["items"]].count(True) == 1
    world.as_(world.rita)
    assert world.client.post("/api/notifications/read-all").json() == {"unread": 0}
    assert count(world, world.rita) == 0


def test_nobody_sees_or_marks_another_persons_notifications(world):
    requirement(world, recruiter_ids=[world.rita.id])
    ritas = bell(world, world.rita)["items"][0]
    world.as_(world.rob)
    assert world.client.get("/api/notifications").json()["items"] == []
    world.client.post(f"/api/notifications/{ritas['id']}/read")
    world.client.post("/api/notifications/read-all")
    assert count(world, world.rita) == 1                                                  # untouched


def test_the_list_is_newest_first_and_pages(world):
    for n in range(5):
        requirement(world, recruiter_ids=[world.rita.id], position=f"Role {n}")
    world.as_(world.rita)
    page = world.client.get("/api/notifications", params={"limit": 3}).json()
    assert [i["title"].split(": ")[1] for i in page["items"]] == ["Role 4", "Role 3", "Role 2"] and page["has_more"] is True
    rest = world.client.get("/api/notifications", params={"limit": 3, "before": page["items"][-1]["created_at"]}).json()
    assert [i["title"].split(": ")[1] for i in rest["items"]] == ["Role 1", "Role 0"] and rest["has_more"] is False
    latest = world.client.get("/api/notifications/unread-count").json()["latest_id"]
    assert latest == page["items"][0]["id"]                                              # what the bell chimes for


# ------------------------------------------------------------------------------------------------------------- bug reports
def test_bug_reports_tell_the_admins_and_the_reporter_hears_the_status_and_the_answer(world):
    world.as_(world.rita)
    bug = world.client.post("/api/bugs", json={"title": "Export is empty", "description": "The Excel file has no rows in it."}).json()
    for admin in (world.admin, world.admin2):
        items = bell(world, admin)["items"]
        assert items[0]["kind"] == "bug_reported" and "Export is empty" in items[0]["title"] and items[0]["link"] == "/admin/bugs"
    world.as_(world.admin)
    world.client.patch(f"/api/admin/bugs/{bug['id']}", json={"status": "in_progress"})
    got = bell(world, world.rita)["items"][0]
    assert got["kind"] == "bug_status" and got["title"] == "Your bug report is now In progress" and got["link"] == f"/report-bug?bug={bug['id']}"
    world.as_(world.admin)
    world.client.patch(f"/api/admin/bugs/{bug['id']}", json={"admin_note": "Fixed in the next release"})
    got = bell(world, world.rita)["items"][0]
    assert got["kind"] == "bug_reply" and "Fixed in the next release" in got["body"]
    world.as_(world.admin)
    world.client.patch(f"/api/admin/bugs/{bug['id']}", json={"severity": "high"})        # nothing the reporter needs to know
    assert count(world, world.rita) == 2
    assert count(world, world.admin2) == 1                                                # the other admin's own count is theirs


# ------------------------------------------------------------------------------------------------------------- 30 days, and never more
def _aged(world, who, days, n=1):
    for _ in range(n):
        world.session.add(Notification(user_id=who.id, kind="requirement_assigned", title=f"{days} days old",
                                       created_at=datetime.utcnow() - timedelta(days=days)))
    world.session.commit()


def test_older_than_30_days_is_never_shown_or_counted_and_the_clean_up_deletes_it(world):
    _aged(world, world.rita, 31)
    _aged(world, world.rita, 29)
    items = bell(world, world.rita)["items"]
    assert [i["title"] for i in items] == ["29 days old"] and count(world, world.rita) == 1
    assert svc.purge(world.engine) == 1
    assert [n.title for n in world.session.exec(select(Notification)).all()] == ["29 days old"]


def test_the_clean_up_keeps_at_most_the_cap_per_person(world, monkeypatch):
    monkeypatch.setattr(settings, "NOTIFICATION_MAX_PER_USER", 3)
    for d in (1, 2, 3, 4, 5):
        _aged(world, world.rita, d)
    _aged(world, world.rob, 1)
    assert svc.purge(world.engine) == 2
    left = sorted(n.title for n in world.session.exec(select(Notification).where(Notification.user_id == world.rita.id)).all())
    assert left == ["1 days old", "2 days old", "3 days old"]                             # the newest three
    assert len(world.session.exec(select(Notification).where(Notification.user_id == world.rob.id)).all()) == 1
