"""The authenticator-app (TOTP) second factor: setup with a QR code, sign-in with a 6-digit code, replay and lockout protection, and the
admin's controls (choose the mode, reset a lost phone)."""
from types import SimpleNamespace

import pyotp
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel

from app.api.deps import require_admin
from app.api.routers import admin as admin_routes
from app.api.routers import auth as auth_routes
from app.db.database import get_session
from app.models.user import User
from app.security import totp as totp_factor
from app.security.auth import hash_password

PASSWORD = "Str0ng-Passw0rd!x"


@pytest.fixture(autouse=True)
def fresh_lockout_counters(monkeypatch):
    """Failed attempts are counted per address and account in a shared cache: each test starts with an empty one."""
    from app.providers.cache.redis import RedisCacheService
    from app.security import login_guard
    cache = RedisCacheService()
    monkeypatch.setattr(login_guard, "get_redis_cache", lambda: cache)


@pytest.fixture
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[User.__table__])
    session = Session(engine)

    def add(username, role="user", otp_mode="totp", **kw):
        user = User(username=username, password_hash=hash_password(PASSWORD), role=role, is_active=True, otp_mode=otp_mode,
                    email=f"{username}@example.com", location="Dubai" if role == "user" else None, **kw)
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    root = add("root", role="admin", otp_mode="captcha")
    rita, omar = add("rita"), add("omar")
    # the admin as the routes see it; a plain object, because the shared session is closed by the sign-in routes between requests
    caller = {"user": SimpleNamespace(id=root.id, username=root.username, role="admin")}
    app = FastAPI()
    app.include_router(auth_routes.router)
    app.include_router(admin_routes.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[require_admin] = lambda: caller["user"]
    client = TestClient(app)
    yield SimpleNamespace(client=client, session=session, root=root, rita=rita, omar=omar, add=add, caller=caller)
    session.close()


def body(email, **extra):
    return {"email": email, "password": PASSWORD, **extra}


def fresh(world, user):
    world.session.expire_all()
    return world.session.get(User, user.id)


def secret_of(world, user):
    return totp_factor.decrypt_secret(fresh(world, user).totp_secret)


def set_up(world, user):
    """Run the setup and return the secret shown to the person (what their phone would hold)."""
    shown = world.client.post("/api/auth/totp/setup", json=body(user.email))
    assert shown.status_code == 200, shown.text
    return secret_of(world, user)


# ---- what the password step tells the page ----
def test_the_password_step_names_the_authenticator_and_whether_it_is_set_up(world):
    first = world.client.post("/api/auth/verify-password", json=body(world.rita.email)).json()
    assert first["auth_mode"] == "totp" and first["requires_otp"] is True and first["totp_enrolled"] is False
    secret = set_up(world, world.rita)
    assert world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=pyotp.TOTP(secret).now())).status_code == 200
    again = world.client.post("/api/auth/verify-password", json=body(world.rita.email)).json()
    assert again["auth_mode"] == "totp" and again["totp_enrolled"] is True


def test_a_wrong_password_learns_nothing_about_the_authenticator(world):
    r = world.client.post("/api/auth/verify-password", json={"email": world.rita.email, "password": "wrong-Passw0rd!"})
    assert r.status_code == 401 and "totp" not in r.text.lower()


# ---- setup ----
def test_the_setup_shows_a_qr_code_and_keeps_the_secret_encrypted(world):
    r = world.client.post("/api/auth/totp/setup", json=body(world.rita.email))
    assert r.status_code == 200
    shown = r.json()
    assert shown["qr"].startswith("data:image/svg+xml;base64,") and shown["issuer"] == "AlphaCV" and shown["account"] == world.rita.email
    secret = secret_of(world, world.rita)
    assert shown["secret"].replace(" ", "") == secret
    stored = fresh(world, world.rita).totp_secret
    assert secret not in stored                              # only the encrypted form is in the database
    assert fresh(world, world.rita).totp_enrolled is False   # not finished until a code is accepted


def test_asking_again_before_the_first_code_shows_the_same_secret(world):
    first = world.client.post("/api/auth/totp/setup", json=body(world.rita.email)).json()
    second = world.client.post("/api/auth/totp/setup", json=body(world.rita.email)).json()
    assert first["secret"] == second["secret"]               # a refresh must not invalidate a scan


def test_the_setup_needs_the_password_and_the_authenticator_mode(world):
    assert world.client.post("/api/auth/totp/setup", json={"email": world.rita.email, "password": "wrong-Passw0rd!"}).status_code == 401
    assert world.client.post("/api/auth/totp/setup", json={"email": "nobody@example.com", "password": PASSWORD}).status_code == 401
    other = world.add("sam", otp_mode="captcha")
    assert world.client.post("/api/auth/totp/setup", json=body(other.email)).status_code == 400
    assert fresh(world, other).totp_secret is None


def test_once_finished_the_setup_cannot_be_started_again(world):
    secret = set_up(world, world.rita)
    assert world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=pyotp.TOTP(secret).now())).status_code == 200
    again = world.client.post("/api/auth/totp/setup", json=body(world.rita.email))
    assert again.status_code == 409                          # somebody who knows the password cannot swap the phone
    assert secret_of(world, world.rita) == secret


# ---- sign in ----
def test_the_first_correct_code_finishes_the_setup_and_signs_in(world):
    secret = set_up(world, world.rita)
    r = world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=pyotp.TOTP(secret).now()))
    assert r.status_code == 200 and r.json()["access_token"] and r.json()["username"] == "rita"
    assert fresh(world, world.rita).totp_enrolled is True


def test_spaces_in_the_code_are_ignored(world):
    secret = set_up(world, world.rita)
    code = pyotp.TOTP(secret).now()
    assert world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=f"{code[:3]} {code[3:]}")).status_code == 200


def test_a_code_works_once(world):
    secret = set_up(world, world.rita)
    code = pyotp.TOTP(secret).now()
    assert world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=code)).status_code == 200
    replay = world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=code))
    assert replay.status_code == 401 and "access_token" not in replay.text
    assert "already used" in replay.json()["detail"]          # said plainly: the code is right, but the app still shows the same one


def test_a_wrong_code_and_a_malformed_code_are_refused(world):
    secret = set_up(world, world.rita)
    good = pyotp.TOTP(secret).now()
    wrong = "000000" if good != "000000" else "111111"
    for code in (wrong, "12345", "abcdef", ""):                # fewer than the lockout limit
        r = world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=code))
        assert r.status_code == 401, code
        assert "access_token" not in r.text
    assert fresh(world, world.rita).totp_enrolled is False


def test_the_code_needs_the_password_too(world):
    secret = set_up(world, world.rita)
    r = world.client.post("/api/auth/totp/verify", json={"email": world.rita.email, "password": "wrong-Passw0rd!", "code": pyotp.TOTP(secret).now()})
    assert r.status_code == 401 and "access_token" not in r.text


def test_another_accounts_code_does_not_work(world):
    mine, theirs = set_up(world, world.rita), set_up(world, world.omar)
    assert mine != theirs
    r = world.client.post("/api/auth/totp/verify", json=body(world.omar.email, code=pyotp.TOTP(mine).now()))
    assert r.status_code == 401


def test_verifying_before_the_setup_is_refused(world):
    r = world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code="123456"))
    assert r.status_code == 400 and "access_token" not in r.text


def test_a_deactivated_account_cannot_use_a_code(world):
    secret = set_up(world, world.rita)
    code = pyotp.TOTP(secret).now()
    world.rita.is_active = False
    world.session.add(world.rita)
    world.session.commit()
    assert world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=code)).status_code == 401


def test_wrong_codes_count_towards_the_lockout(world, monkeypatch):
    failures = []
    monkeypatch.setattr(auth_routes, "record_failure", lambda email, ip: failures.append(email))
    set_up(world, world.rita)
    world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code="000000"))
    assert failures == [world.rita.email]


def test_five_wrong_codes_lock_the_sign_in_even_for_the_right_code(world):
    secret = set_up(world, world.rita)
    good = pyotp.TOTP(secret).now()
    wrong = "000000" if good != "000000" else "111111"
    for _ in range(5):
        assert world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=wrong)).status_code == 401
    locked = world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=good))
    assert locked.status_code == 429 and "access_token" not in locked.text      # guessing six digits is not possible, even slowly


def test_the_other_second_steps_refuse_an_authenticator_account(world):
    sent = world.client.post("/api/auth/send-otp", json=body(world.rita.email))
    assert sent.status_code == 400 and "authenticator" in sent.json()["detail"]
    shown = world.client.post("/api/auth/captcha", json=body(world.rita.email, fingerprint="x"))
    assert shown.status_code == 400
    assert world.client.post("/api/auth/login", json=body(world.rita.email)).status_code == 403      # the password alone is never enough


# ---- the code itself ----
def test_the_clock_window_is_one_step_either_side():
    secret = totp_factor.new_secret()
    t = pyotp.TOTP(secret)
    now = 1_900_000_000.0
    step = int(now // 30)
    assert totp_factor.matching_step(secret, t.at(now), now) == step
    assert totp_factor.matching_step(secret, t.at(now - 30), now) == step - 1
    assert totp_factor.matching_step(secret, t.at(now + 30), now) == step + 1
    assert totp_factor.matching_step(secret, t.at(now - 90), now) is None
    assert totp_factor.matching_step(secret, t.at(now + 90), now) is None


def test_a_secret_that_cannot_be_decrypted_is_treated_as_missing(monkeypatch):
    stored = totp_factor.encrypt_secret(totp_factor.new_secret())
    assert totp_factor.decrypt_secret(stored)
    monkeypatch.setattr(totp_factor.settings, "TOTP_ENCRYPTION_KEY", "another key entirely")
    assert totp_factor.decrypt_secret(stored) is None and totp_factor.decrypt_secret("garbage") is None and totp_factor.decrypt_secret(None) is None


# ---- the admin ----
def test_the_admin_can_choose_the_authenticator_for_an_account(world):
    other = world.add("sam", otp_mode="real")
    r = world.client.patch(f"/api/admin/users/{other.id}", json={"otp_mode": "totp"})
    assert r.status_code == 200 and r.json()["otp_mode"] == "totp" and r.json()["totp_enrolled"] is False
    created = world.client.post("/api/admin/users", json={"username": "newbie", "password": PASSWORD, "email": "newbie@example.com",
                                                          "otp_mode": "totp", "role": "user", "location": "Dubai"})
    assert created.status_code == 201 and created.json()["otp_mode"] == "totp"
    bad = world.client.patch(f"/api/admin/users/{other.id}", json={"otp_mode": "sms"})
    assert bad.status_code == 422


def test_leaving_the_authenticator_removes_the_secret(world):
    set_up(world, world.rita)
    assert world.client.patch(f"/api/admin/users/{world.rita.id}", json={"otp_mode": "captcha"}).status_code == 200
    gone = fresh(world, world.rita)
    assert gone.totp_secret is None and gone.totp_enrolled is False and gone.totp_last_step is None


def test_the_admin_resets_a_lost_phone(world):
    secret = set_up(world, world.rita)
    assert world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=pyotp.TOTP(secret).now())).status_code == 200
    r = world.client.post(f"/api/admin/users/{world.rita.id}/reset-authenticator")
    assert r.status_code == 200 and r.json()["totp_enrolled"] is False and r.json()["otp_mode"] == "totp"
    cleared = fresh(world, world.rita)
    assert cleared.totp_secret is None and cleared.totp_last_step is None
    assert world.client.post("/api/auth/verify-password", json=body(world.rita.email)).json()["totp_enrolled"] is False
    new_secret = set_up(world, world.rita)
    assert new_secret != secret                                # a new QR code, and the old phone's codes no longer work
    old = world.client.post("/api/auth/totp/verify", json=body(world.rita.email, code=pyotp.TOTP(secret).now()))
    assert old.status_code == 401


def test_reset_only_applies_to_accounts_on_the_authenticator(world):
    other = world.add("sam", otp_mode="real")
    assert world.client.post(f"/api/admin/users/{other.id}/reset-authenticator").status_code == 400
    assert world.client.post("/api/admin/users/no-such-id/reset-authenticator").status_code == 404


def test_only_the_admin_can_reset(world):
    from app.api.deps import require_admin as dependency
    world.client.app.dependency_overrides.pop(dependency)
    r = world.client.post(f"/api/admin/users/{world.rita.id}/reset-authenticator")
    assert r.status_code in (401, 403)


def test_the_database_accepts_the_authenticator_mode_and_nothing_else_new(world):
    world.add("ok1", otp_mode="totp")
    with pytest.raises(IntegrityError):
        world.add("bad1", otp_mode="sms")
    world.session.rollback()
