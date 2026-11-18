"""The admin's view of blocked sign-ins: who is failing, who has reached the limit, and lifting one block."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import require_admin
from app.api.routers import admin
from app.config.settings import settings
from app.security import login_guard


@pytest.fixture
def world(monkeypatch):
    from app.providers.cache.redis import RedisCacheService
    cache = RedisCacheService()                                   # empty for this test (the in-memory fallback when Redis is not running)
    monkeypatch.setattr(login_guard, "get_redis_cache", lambda: cache)
    app = FastAPI()
    app.include_router(admin.router)
    app.dependency_overrides[require_admin] = lambda: SimpleNamespace(username="root", role="admin")
    return SimpleNamespace(client=TestClient(app), app=app)


def fail(username, ip, times):
    for _ in range(times):
        login_guard.record_failure(username, ip)


def listing(world):
    return world.client.get("/api/admin/security/lockouts").json()


def test_nothing_is_listed_when_nobody_has_failed(world):
    data = listing(world)
    assert data["items"] == [] and data["lockout_seconds"] == settings.LOGIN_LOCKOUT_SECONDS
    assert data["limits"]["username_ip"] == settings.LOGIN_MAX_FAILED_ATTEMPTS


def test_failures_are_listed_and_the_blocked_ones_come_first(world):
    fail("rita@x.com", "10.1.1.1", 2)                              # failing, not yet blocked
    fail("omar@x.com", "10.2.2.2", settings.LOGIN_MAX_FAILED_ATTEMPTS)   # blocked from that address
    items = listing(world)["items"]
    blocked = [i for i in items if i["blocked"]]
    assert [(i["kind"], i["username"], i["ip"]) for i in blocked] == [("username_ip", "omar@x.com", "10.2.2.2")]
    assert items[0]["blocked"] is True                              # blocked rows are on top
    rita = next(i for i in items if i["kind"] == "username_ip" and i["username"] == "rita@x.com")
    assert rita["attempts"] == 2 and rita["blocked"] is False and rita["limit"] == settings.LOGIN_MAX_FAILED_ATTEMPTS
    assert rita["seconds_left"] and 0 < rita["seconds_left"] <= settings.LOGIN_LOCKOUT_SECONDS
    # the same failures also count against the account (any address) and the address (any account)
    assert {i["kind"] for i in items} == {"username_ip", "account", "ip"}


def test_an_address_that_tried_too_many_accounts_is_blocked_for_all_accounts(world):
    for n in range(settings.LOGIN_MAX_FAILED_ATTEMPTS_PER_IP):
        login_guard.record_failure(f"user{n}@x.com", "203.0.113.9")
    ip_rows = [i for i in listing(world)["items"] if i["kind"] == "ip"]
    assert len(ip_rows) == 1 and ip_rows[0]["ip"] == "203.0.113.9" and ip_rows[0]["blocked"] is True and ip_rows[0]["username"] is None


def test_unlocking_lets_the_person_try_again(world):
    fail("omar@x.com", "10.2.2.2", settings.LOGIN_MAX_FAILED_ATTEMPTS)
    assert login_guard.check_lockout("omar@x.com", "10.2.2.2")[0] is True
    r = world.client.post("/api/admin/security/lockouts/unlock", json={"kind": "username_ip", "username": "omar@x.com", "ip": "10.2.2.2"})
    assert r.status_code == 200 and r.json() == {"unlocked": True}
    assert login_guard.check_lockout("omar@x.com", "10.2.2.2")[0] is False
    assert not [i for i in listing(world)["items"] if i["kind"] == "username_ip"]


def test_unlocking_an_account_and_an_address(world):
    fail("a@x.com", "10.3.3.3", 1)
    for body in ({"kind": "account", "username": "a@x.com"}, {"kind": "ip", "ip": "10.3.3.3"}):
        assert world.client.post("/api/admin/security/lockouts/unlock", json=body).status_code == 200
    assert [i["kind"] for i in listing(world)["items"]] == ["username_ip"]       # only the one that was not named is left


def test_an_unlock_must_name_what_to_unlock(world):
    for body in ({"kind": "ip"}, {"kind": "account"}, {"kind": "username_ip", "username": "a@x.com"}):
        assert world.client.post("/api/admin/security/lockouts/unlock", json=body).status_code == 400
    assert world.client.post("/api/admin/security/lockouts/unlock", json={"kind": "everything"}).status_code == 422


def test_only_the_admin_can_see_or_unlock(world):
    world.app.dependency_overrides.pop(require_admin)               # the real guard again: no sign-in, no access
    assert world.client.get("/api/admin/security/lockouts").status_code in (401, 403)
    assert world.client.post("/api/admin/security/lockouts/unlock", json={"kind": "ip", "ip": "1.1.1.1"}).status_code in (401, 403)


def test_the_listing_never_contains_a_password(world):
    fail("rita@x.com", "10.1.1.1", 1)
    assert "password" not in str(listing(world)).lower()
