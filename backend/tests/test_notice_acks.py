"""The login notice: the thumbs-up acknowledgement and the admin's list of who has and has not clicked OK.

The acknowledgement is two columns on the user row (the id of the notice acknowledged, and when); the notice is one message with an id that
changes when its text does."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel

from app.api.deps import require_admin, require_user
from app.api.routers import notices
from app.db.database import get_session
from app.models.user import User
from app.security.auth import hash_password


@pytest.fixture
def world(monkeypatch):
    from app.providers.cache.redis import RedisCacheService
    cache = RedisCacheService()                                  # an empty cache for this test (the in-memory fallback)
    monkeypatch.setattr(notices, "get_redis_cache", lambda: cache)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[User.__table__])
    session = Session(engine)

    def add(username, role="user", **kw):
        user = User(username=username, password_hash=hash_password("pw-" + username), role=role, is_active=True,
                    email=f"{username}@example.com", location="Dubai" if role in ("user", "manager", "account_manager") else None, **kw)
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    root = add("root", role="admin")
    rita, omar, eva = add("rita"), add("omar"), add("eva", role="evp")
    caller = {"who": root}

    def as_(user):
        caller["who"] = SimpleNamespace(id=user.id, username=user.username, role=user.role)

    as_(root)
    app = FastAPI()
    app.include_router(notices.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[require_user] = lambda: caller["who"]
    app.dependency_overrides[require_admin] = lambda: caller["who"]
    client = TestClient(app)
    yield SimpleNamespace(client=client, session=session, root=root, rita=rita, omar=omar, eva=eva, as_=as_, add=add, app=app)
    session.close()


def publish(world, message="Maintenance tonight at 10pm.", active=True):
    world.as_(world.root)
    r = world.client.put("/api/admin/notice", json={"message": message, "active": active})
    assert r.status_code == 200
    return r.json()["notice"]


def seen_by(world, user):
    world.as_(user)
    return world.client.get("/api/notice").json()["notice"]


def thumbs_up(world, user, notice_id):
    world.as_(user)
    return world.client.post("/api/notice/acknowledge", json={"notice_id": notice_id})


def listing(world):
    world.as_(world.root)
    return world.client.get("/api/admin/notice/acknowledgements").json()


def test_a_published_notice_reaches_everybody_but_the_admin(world):
    notice = publish(world)
    for person in (world.rita, world.omar, world.eva):
        assert seen_by(world, person)["id"] == notice["id"]
    assert seen_by(world, world.root) is None


def test_the_thumbs_up_hides_the_notice_for_that_person_only_and_for_good(world):
    notice = publish(world)
    assert thumbs_up(world, world.rita, notice["id"]).json() == {"acknowledged": True}
    assert seen_by(world, world.rita) is None                     # not shown again, on any later sign-in
    assert seen_by(world, world.rita) is None
    assert seen_by(world, world.omar)["id"] == notice["id"]       # the others still get it


def test_a_second_click_changes_nothing_and_keeps_the_first_time(world):
    notice = publish(world)
    thumbs_up(world, world.rita, notice["id"])
    first = listing(world)["users"]
    first_time = next(u for u in first if u["username"] == "rita")["acknowledged_at"]
    assert thumbs_up(world, world.rita, notice["id"]).json() == {"acknowledged": True}
    again = next(u for u in listing(world)["users"] if u["username"] == "rita")
    assert again["acknowledged_at"] == first_time and first_time.endswith("Z")


def test_the_admin_sees_who_clicked_ok_and_who_did_not(world):
    notice = publish(world)
    thumbs_up(world, world.rita, notice["id"])
    thumbs_up(world, world.eva, notice["id"])
    result = listing(world)
    assert result["summary"] == {"total": 3, "acknowledged": 2, "pending": 1}
    assert [u["username"] for u in result["users"]][0] == "omar"                      # those who have not clicked are first
    pending, done = result["users"][0], result["users"][1:]
    assert pending["acknowledged"] is False and pending["acknowledged_at"] is None
    assert {u["username"] for u in done} == {"rita", "eva"} and all(u["acknowledged"] and u["acknowledged_at"] for u in done)
    assert {"id", "username", "email", "role", "location"} <= set(pending)
    assert "root" not in {u["username"] for u in result["users"]}                    # admins are never part of it


def test_deactivated_accounts_are_not_counted(world):
    publish(world)
    world.omar.is_active = False
    world.session.add(world.omar)
    world.session.commit()
    result = listing(world)
    assert result["summary"]["total"] == 2 and "omar" not in {u["username"] for u in result["users"]}


def test_editing_the_text_asks_everybody_again(world):
    old = publish(world, "Maintenance tonight.")
    thumbs_up(world, world.rita, old["id"])
    new = publish(world, "Maintenance moved to tomorrow.")
    assert new["id"] != old["id"]
    assert seen_by(world, world.rita)["id"] == new["id"]            # the old acknowledgement does not count for the new text
    assert listing(world)["summary"] == {"total": 3, "acknowledged": 0, "pending": 3}
    assert thumbs_up(world, world.rita, old["id"]).status_code == 409   # a page still showing the old one is told it changed


def test_hiding_and_showing_the_same_text_does_not_ask_again(world):
    first = publish(world, "Same text.")
    thumbs_up(world, world.rita, first["id"])
    publish(world, "Same text.", active=False)
    assert seen_by(world, world.omar) is None                       # hidden
    again = publish(world, "Same text.", active=True)
    assert again["id"] == first["id"]
    assert seen_by(world, world.rita) is None and seen_by(world, world.omar)["id"] == first["id"]


def test_a_removed_notice_shows_nothing_and_cannot_be_acknowledged(world):
    notice = publish(world)
    thumbs_up(world, world.rita, notice["id"])
    world.as_(world.root)
    assert world.client.delete("/api/admin/notice").json() == {"notice": None}
    assert seen_by(world, world.omar) is None
    assert thumbs_up(world, world.omar, notice["id"]).status_code == 409
    assert listing(world) == {"notice": None, "summary": {"total": 0, "acknowledged": 0, "pending": 0}, "users": []}


def test_a_hidden_notice_cannot_be_acknowledged(world):
    notice = publish(world, active=False)
    assert thumbs_up(world, world.rita, notice["id"]).status_code == 409


def test_the_old_notice_is_not_shown_when_a_new_one_replaces_it_for_someone_who_acknowledged_it(world):
    old = publish(world, "First.")
    thumbs_up(world, world.rita, old["id"])
    new = publish(world, "Second.")
    thumbs_up(world, world.rita, new["id"])
    assert seen_by(world, world.rita) is None
    result = listing(world)
    assert next(u for u in result["users"] if u["username"] == "rita")["acknowledged"] is True
    assert result["summary"]["acknowledged"] == 1                  # only the current notice is counted


def test_an_admin_clicking_changes_nothing(world):
    notice = publish(world)
    assert thumbs_up(world, world.root, notice["id"]).json() == {"acknowledged": False}
    world.session.expire_all()
    assert world.session.get(User, world.root.id).notice_ack_id is None


def test_only_the_admin_can_list_publish_or_remove(world):
    from app.api.deps import require_admin as dependency
    notice = publish(world)
    world.app.dependency_overrides.pop(dependency)                 # the real guard again: no sign-in, no access
    assert world.client.get("/api/admin/notice/acknowledgements").status_code in (401, 403)
    assert world.client.put("/api/admin/notice", json={"message": "x", "active": True}).status_code in (401, 403)
    assert world.client.delete("/api/admin/notice").status_code in (401, 403)
    assert notice["id"]


def test_a_blank_message_is_not_shown(world):
    notice = publish(world, "   ", active=True)
    assert notice["active"] is False and seen_by(world, world.rita) is None
