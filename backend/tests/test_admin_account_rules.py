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
    recruiter = add("rita", "user", email="rita@example.com", location="Dubai")
    caller = {"user": root}
    app = FastAPI()
    app.include_router(A.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[require_admin] = lambda: caller["user"]
    yield SimpleNamespace(client=TestClient(app), session=session, root=root, second=second, recruiter=recruiter, caller=caller)
    session.close()


class JobsStore:
    """Records which people had their jobs switched off."""
    def __init__(self):
        self.switched_off = []

    def deactivate_jobs_posted_by(self, username):
        self.switched_off.append(username)
        return 2


@pytest.fixture
def jobs(monkeypatch):
    store = JobsStore()
    monkeypatch.setattr(A, "get_store", lambda: store)
    return store


def test_the_admin_account_cannot_be_deactivated_by_itself_or_by_another_admin(world, jobs):
    assert world.client.delete(f"/api/admin/users/{world.root.id}").status_code == 403       # itself
    assert world.client.delete(f"/api/admin/users/{world.second.id}").status_code == 403     # another admin
    for who in (world.root, world.second):
        world.session.refresh(who)
        assert who.is_active
    assert jobs.switched_off == []


def test_a_user_is_deactivated_never_deleted_and_their_jobs_are_switched_off(world, jobs):
    rita_id, rita_name = world.recruiter.id, world.recruiter.username
    assert world.client.delete(f"/api/admin/users/{rita_id}").status_code == 204
    world.session.expire_all()
    row = world.session.get(User, rita_id)
    assert row is not None and row.username == rita_name and row.is_active is False and row.role == "user" and row.location == "Dubai"   # still there
    assert jobs.switched_off == ["rita"]
    assert world.client.delete(f"/api/admin/users/{rita_id}").status_code == 204            # again: nothing more happens
    assert jobs.switched_off == ["rita"]
    assert world.client.delete("/api/admin/users/no-such-user").status_code == 404
    # the name is still taken, so nobody else can be given the old person's history
    again = world.client.post("/api/admin/users", json={"username": "rita", "password": "Str0ng!Passw0rd#x", "email": "other@example.com", "role": "user", "location": "Dubai"})
    assert again.status_code == 409


def test_deactivating_in_the_edit_form_switches_the_jobs_off_too_and_reactivating_does_not_switch_them_on(world, jobs):
    rid = world.recruiter.id
    assert world.client.patch(f"/api/admin/users/{rid}", json={"is_active": False}).json()["is_active"] is False
    assert jobs.switched_off == ["rita"]
    assert world.client.patch(f"/api/admin/users/{rid}", json={"is_active": False}).status_code == 200       # already off: no second pass
    assert jobs.switched_off == ["rita"]
    assert world.client.patch(f"/api/admin/users/{rid}", json={"is_active": True}).json()["is_active"] is True
    assert jobs.switched_off == ["rita"]                                                    # their jobs stay off until switched on in Careers


def test_the_admin_role_cannot_be_changed_and_the_admin_cannot_be_deactivated(world):
    for body in ({"role": "user"}, {"role": "manager"}, {"is_active": False}):
        r = world.client.patch(f"/api/admin/users/{world.root.id}", json=body)
        assert r.status_code == 403, body
    world.session.refresh(world.root)
    assert world.root.role == "admin" and world.root.is_active


def test_sending_the_admins_own_values_back_changes_nothing_and_is_not_an_error(world):
    r = world.client.patch(f"/api/admin/users/{world.root.id}", json={"role": "admin", "is_active": True, "otp_mode": "captcha"})
    assert r.status_code == 200 and r.json()["role"] == "admin"


def test_the_admins_mfa_can_be_switched_between_captcha_and_email(world):
    """What this feature adds: the admin's second sign-in step is editable on the Users page."""
    from app.models.user import User
    from app.security.auth import hash_password

    boss = User(username="boss2", password_hash=hash_password("x"), role="admin", is_active=True,
                email="boss2@example.com", otp_mode="captcha")
    world.session.add(boss)
    world.session.commit()
    world.session.refresh(boss)

    r = world.client.patch(f"/api/admin/users/{boss.id}", json={"otp_mode": "real"})
    assert r.status_code == 200 and r.json()["otp_mode"] == "real"
    r = world.client.patch(f"/api/admin/users/{boss.id}", json={"otp_mode": "captcha"})
    assert r.status_code == 200 and r.json()["otp_mode"] == "captcha"


def test_email_mfa_needs_an_email_address_on_the_account(world):
    """An admin with no email cannot be put on email codes: there is nowhere to send them, so it stays on the CAPTCHA."""
    from app.models.user import User
    from app.security.auth import hash_password

    no_email = User(username="boss3", password_hash=hash_password("x"), role="admin", is_active=True, otp_mode="captcha")
    world.session.add(no_email)
    world.session.commit()
    world.session.refresh(no_email)

    r = world.client.patch(f"/api/admin/users/{no_email.id}", json={"otp_mode": "real"})
    assert r.status_code == 400
    world.session.refresh(no_email)
    assert no_email.otp_mode == "captcha"


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
        r = world.client.post("/api/admin/users", json={"username": f"p-{role}", "password": "river-stone-4821", "role": role, "email": f"{role}@example.com", "location": "Dubai"})
        assert r.status_code == 201 and r.json()["role"] == role, role
    r = world.client.patch(f"/api/admin/users/{world.recruiter.id}", json={"role": "manager"})
    assert r.status_code == 200 and r.json()["role"] == "manager"
    assert world.client.post("/api/admin/users", json={"username": "x-guest", "password": "river-stone-4821", "role": "guest", "email": "g@example.com"}).status_code == 422


def test_there_is_no_team_any_more(world):
    r = world.client.get("/api/admin/users")
    assert r.status_code == 200 and all("team_location" not in u for u in r.json())
    assert not hasattr(User, "team_location")


def _new(role, **kw):
    return {"username": f"n-{role}", "password": "river-stone-4821", "role": role, "email": f"n-{role}@example.com", **kw}


def test_location_is_chosen_when_the_login_is_created_and_then_fixed(world):
    for role in ("user", "manager", "account_manager"):
        assert world.client.post("/api/admin/users", json=_new(role)).status_code == 422, role           # location is required
        assert world.client.post("/api/admin/users", json=_new(role, location="Nowhere")).status_code == 422
    made = world.client.post("/api/admin/users", json=_new("user", location="Abu Dhabi")).json()
    assert made["location"] == "Abu Dhabi"
    evp = world.client.post("/api/admin/users", json=_new("evp", location="Dubai")).json()
    assert evp["location"] is None                                                                     # the EVP sees every location
    # it cannot be changed afterwards
    assert world.client.patch(f"/api/admin/users/{made['id']}", json={"location": "Dubai"}).status_code == 403
    assert world.client.patch(f"/api/admin/users/{made['id']}", json={"location": "Abu Dhabi"}).status_code == 200
    # an account without one (made before locations existed) may be given one, once; and cannot become a located role without it
    old = User(username="old", password_hash="x", role="evp", is_active=True, email="old@example.com")
    world.session.add(old)
    world.session.commit()
    assert world.client.patch(f"/api/admin/users/{old.id}", json={"role": "manager"}).status_code == 400
    assert world.client.patch(f"/api/admin/users/{old.id}", json={"role": "manager", "location": "Dubai"}).json()["location"] == "Dubai"
    assert world.client.patch(f"/api/admin/users/{world.root.id}", json={"location": "Dubai"}).status_code in (400, 403)


def test_making_someone_an_evp_clears_their_location_and_the_database_accepts_it(world, jobs):
    r = world.client.patch(f"/api/admin/users/{world.recruiter.id}", json={"role": "evp"})
    assert r.status_code == 200 and r.json()["role"] == "evp" and r.json()["location"] is None       # an EVP sees every location
    assert world.client.patch(f"/api/admin/users/{world.recruiter.id}", json={"role": "user"}).status_code == 400     # and needs one again to be a recruiter
    assert world.client.patch(f"/api/admin/users/{world.recruiter.id}", json={"role": "user", "location": "Abu Dhabi"}).json()["location"] == "Abu Dhabi"
