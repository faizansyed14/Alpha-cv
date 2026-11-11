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
    recruiter = add("rita", "user", email="rita@example.com")
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


def test_sending_the_admins_own_values_back_changes_nothing_and_is_not_an_error(world):
    r = world.client.patch(f"/api/admin/users/{world.root.id}", json={"role": "admin", "is_active": True, "otp_mode": "captcha"})
    assert r.status_code == 200 and r.json()["role"] == "admin"


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


def test_every_staff_role_can_be_created_and_changed(world):
    for role in ("user", "manager", "evp", "account_manager"):                    # recruiter, recruitment manager, EVP, sales manager
        r = world.client.post("/api/admin/users", json={"username": f"p-{role}", "password": "river-stone-4821", "role": role, "email": f"{role}@example.com"})
        assert r.status_code == 201 and r.json()["role"] == role, role
    r = world.client.patch(f"/api/admin/users/{world.recruiter.id}", json={"role": "manager"})
    assert r.status_code == 200 and r.json()["role"] == "manager"
    assert world.client.post("/api/admin/users", json={"username": "x-guest", "password": "river-stone-4821", "role": "guest", "email": "g@example.com"}).status_code == 422


def test_there_is_no_team_any_more(world):
    r = world.client.get("/api/admin/users")
    assert r.status_code == 200 and all("team_location" not in u for u in r.json())
    assert not hasattr(User, "team_location")
