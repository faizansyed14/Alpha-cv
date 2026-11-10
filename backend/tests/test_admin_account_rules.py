"""The admin account is fixed: it cannot be deleted, demoted, deactivated, given a team, or created/promoted through the API."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel

from app.api.deps import require_admin
from app.api.routers import admin as A
from app.db.database import get_session
from app.models.user import User
from app.security.auth import hash_password


@pytest.fixture
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[User.__table__])
    session = Session(engine)

    def add(username, role, **kw):
        user = User(username=username, password_hash=hash_password("pw-" + username), role=role, is_active=True, **kw)
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    root, second = add("root", "admin"), add("second", "admin")
    recruiter = add("rita", "user", email="rita@example.com", team_location="Dubai")
    caller = {"user": root}
    app = FastAPI()
    app.include_router(A.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[require_admin] = lambda: caller["user"]
    yield SimpleNamespace(client=TestClient(app), session=session, root=root, second=second, recruiter=recruiter, caller=caller)
    session.close()


def test_the_admin_account_cannot_be_deleted_by_itself_or_by_another_admin(world):
    assert world.client.delete(f"/api/admin/users/{world.root.id}").status_code == 403       # itself
    assert world.client.delete(f"/api/admin/users/{world.second.id}").status_code == 403     # another admin
    assert world.session.get(User, world.root.id) is not None and world.session.get(User, world.second.id) is not None


def test_other_users_can_still_be_deleted(world):
    assert world.client.delete(f"/api/admin/users/{world.recruiter.id}").status_code == 204
    assert world.client.delete(f"/api/admin/users/{world.recruiter.id}").status_code == 404


def test_the_admin_role_cannot_be_changed_and_the_admin_cannot_be_deactivated(world):
    for body in ({"role": "user"}, {"role": "manager"}, {"is_active": False}):
        r = world.client.patch(f"/api/admin/users/{world.root.id}", json=body)
        assert r.status_code == 403, body
    world.session.refresh(world.root)
    assert world.root.role == "admin" and world.root.is_active


def test_the_admin_has_no_team_location(world):
    r = world.client.patch(f"/api/admin/users/{world.root.id}", json={"team_location": "Dubai"})
    assert r.status_code == 403
    world.session.refresh(world.root)
    assert world.root.team_location is None


def test_sending_the_admins_own_values_back_changes_nothing_and_is_not_an_error(world):
    r = world.client.patch(f"/api/admin/users/{world.root.id}", json={"role": "admin", "is_active": True, "otp_mode": "captcha"})
    assert r.status_code == 200 and r.json()["role"] == "admin" and r.json()["team_location"] is None


def test_nobody_changes_the_admins_email_or_password_through_the_api(world):
    """They are set in .env: not by another admin, and not by the admin themself either."""
    for target in (world.root, world.second):                                       # the caller is root
        before = (target.password_hash, target.email)
        for body in ({"password": "a-new-password"}, {"email": "x@example.com"}):
            assert world.client.patch(f"/api/admin/users/{target.id}", json=body).status_code == 403, (target.username, body)
        world.session.refresh(target)
        assert (target.password_hash, target.email) == before


def test_nobody_is_created_as_or_promoted_to_admin(world):
    r = world.client.post("/api/admin/users", json={"username": "boss", "password": "river-stone-4821", "role": "admin", "email": "boss@example.com"})
    assert r.status_code == 403
    r = world.client.patch(f"/api/admin/users/{world.recruiter.id}", json={"role": "admin"})
    assert r.status_code == 403
    world.session.refresh(world.recruiter)
    assert world.recruiter.role == "user"


def test_other_roles_can_still_be_created_and_changed(world):
    r = world.client.post("/api/admin/users", json={"username": "mo", "password": "pw-mo-12345", "role": "manager",
                                                    "email": "mo@example.com", "team_location": "Abu Dhabi"})
    assert r.status_code == 201 and r.json()["team_location"] == "Abu Dhabi"
    r = world.client.patch(f"/api/admin/users/{world.recruiter.id}", json={"role": "manager", "team_location": "Abu Dhabi"})
    assert r.status_code == 200 and r.json()["role"] == "manager" and r.json()["team_location"] == "Abu Dhabi"
    r = world.client.patch(f"/api/admin/users/{world.recruiter.id}", json={"team_location": ""})        # cleared
    assert r.status_code == 200 and r.json()["team_location"] is None


def test_a_team_location_must_be_a_known_team(world):
    r = world.client.post("/api/admin/users", json={"username": "zed", "password": "pw-zed-12345", "role": "user",
                                                    "email": "z@example.com", "team_location": "Mars"})
    assert r.status_code == 400
    assert world.client.patch(f"/api/admin/users/{world.recruiter.id}", json={"team_location": "Mars"}).status_code == 400


def test_startup_clears_a_team_left_on_the_admin(world):
    from app.db.database import clear_admin_team

    world.root.team_location = "Dubai"
    world.session.add(world.root)
    world.session.commit()
    clear_admin_team(world.session)
    world.session.refresh(world.root)
    world.session.refresh(world.recruiter)
    assert world.root.team_location is None and world.recruiter.team_location == "Dubai"


def test_an_email_is_required_and_belongs_to_one_account(world):
    base = {"username": "mo", "password": "pw-mo-12345", "role": "manager"}
    assert world.client.post("/api/admin/users", json=base).status_code == 422                                  # no email, no account
    assert world.client.post("/api/admin/users", json={**base, "email": "not-an-email"}).status_code == 422
    made = world.client.post("/api/admin/users", json={**base, "email": "Mo@Example.com"})
    assert made.status_code == 201 and made.json()["email"] == "mo@example.com"                                 # stored in lower case
    other = {**base, "username": "mo2", "email": "MO@example.COM"}
    assert world.client.post("/api/admin/users", json=other).status_code == 409                                 # same address, other capitals
    assert world.client.post("/api/admin/users", json={**other, "email": "mo2@example.com"}).status_code == 201
    # changing an address to one that is taken is refused; keeping your own is fine
    uid = world.session.query(User).filter(User.username == "mo2").one().id
    assert world.client.patch(f"/api/admin/users/{uid}", json={"email": "Mo@example.com"}).status_code == 409
    assert world.client.patch(f"/api/admin/users/{uid}", json={"email": "MO2@example.com"}).status_code == 200


def _env(monkeypatch, email, password="env-password-1"):
    from app.config.settings import settings

    monkeypatch.setattr(settings, "ADMIN_USERNAME", "root")
    monkeypatch.setattr(settings, "ADMIN_EMAIL", email)
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", password)


def test_the_admins_email_and_password_follow_the_env_file_at_every_start(world, monkeypatch):
    from app.db.database import sync_admin_from_env
    from app.security.auth import verify_password

    _env(monkeypatch, "Boss@Example.com")
    sync_admin_from_env(world.session)
    world.session.refresh(world.root)
    assert world.root.email == "boss@example.com" and verify_password("env-password-1", world.root.password_hash)

    _env(monkeypatch, "other@example.com", "a-different-password-2")                 # .env changed: the next start follows it
    sync_admin_from_env(world.session)
    world.session.refresh(world.root)
    assert world.root.email == "other@example.com" and verify_password("a-different-password-2", world.root.password_hash)
    assert not verify_password("env-password-1", world.root.password_hash)


def test_nothing_is_rewritten_when_the_admin_already_matches_the_env_file(world, monkeypatch):
    from app.db.database import sync_admin_from_env

    _env(monkeypatch, "boss@example.com")
    sync_admin_from_env(world.session)
    world.session.refresh(world.root)
    hashed = world.root.password_hash
    sync_admin_from_env(world.session)
    world.session.refresh(world.root)
    assert world.root.password_hash == hashed                                         # the hash is not re-salted on every start


def test_the_env_admin_is_kept_an_active_admin_and_only_that_account_is_synced(world, monkeypatch):
    from app.db.database import sync_admin_from_env

    _env(monkeypatch, "boss@example.com")
    world.root.is_active = False
    world.session.add(world.root)
    world.session.commit()
    others = (world.second.email, world.second.password_hash, world.recruiter.email, world.recruiter.password_hash)
    sync_admin_from_env(world.session)
    world.session.refresh(world.root)
    assert world.root.is_active and world.root.role == "admin"
    for u in (world.second, world.recruiter):
        world.session.refresh(u)
    assert (world.second.email, world.second.password_hash, world.recruiter.email, world.recruiter.password_hash) == others


def test_a_taken_address_is_not_given_to_the_admin(world, monkeypatch):
    from app.db.database import sync_admin_from_env

    _env(monkeypatch, "rita@example.com")                                              # rita already signs in with it
    sync_admin_from_env(world.session)
    world.session.refresh(world.root)
    assert world.root.email is None


def test_without_an_admin_email_in_env_the_admin_keeps_what_it_has(world, monkeypatch):
    from app.db.database import sync_admin_from_env

    world.root.email = "kept@example.com"
    world.session.add(world.root)
    world.session.commit()
    _env(monkeypatch, "")
    sync_admin_from_env(world.session)
    world.session.refresh(world.root)
    assert world.root.email == "kept@example.com"


def test_the_database_itself_refuses_two_accounts_with_one_address(world):
    from sqlalchemy.exc import IntegrityError

    world.session.add(User(username="dup", password_hash="x", role="user", email="RITA@example.com", is_active=True))
    with pytest.raises(IntegrityError):
        world.session.commit()
    world.session.rollback()
