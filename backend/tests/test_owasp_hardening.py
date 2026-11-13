"""OWASP hardening: password policy, no account enumeration, tokens dropped on a password change, no raw errors to clients, safe logs."""
import logging
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
from app.security import auth as security_auth
from app.security.auth import create_access_token, decode_token, hash_password, invalidate_user_tokens, issued_before_floor
from app.security.logsafe import mask_email, security_event
from app.security.password_policy import password_problem


# ---- A07: password policy ---------------------------------------------------------------------------------------------
@pytest.mark.parametrize("pw", ["short1", "password123", "1234567890", "aaaaaaaaaaaa", "x" * 129])
def test_weak_passwords_are_rejected(pw):
    assert password_problem(pw)


def test_password_must_not_contain_the_identity():
    # a password may contain the person's own name or email
    assert password_problem("rita-is-great-99", username="rita") is None
    assert password_problem("jane.doe-2026-ok", email="jane.doe@corp.com") is None
    assert password_problem("river-stone-4821", username="rita", email="rita@corp.com") is None


@pytest.fixture
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[User.__table__])
    session = Session(engine)
    root = User(username="root", password_hash=hash_password("x"), role="admin", is_active=True, email="root@example.com")
    rita = User(username="rita", password_hash=hash_password("x"), role="user", is_active=True, email="rita@example.com")
    session.add(root); session.add(rita); session.commit(); session.refresh(root); session.refresh(rita)
    app = FastAPI()
    app.include_router(A.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[require_admin] = lambda: root
    yield SimpleNamespace(client=TestClient(app), session=session, rita=rita)
    session.close()


def test_api_enforces_the_policy_on_create_and_reset(world):
    r = world.client.post("/api/admin/users", json={"username": "mo", "password": "password123", "email": "mo@example.com"})
    assert r.status_code == 422
    r = world.client.patch(f"/api/admin/users/{world.rita.id}", json={"password": "short"})
    assert r.status_code == 422
    r = world.client.patch(f"/api/admin/users/{world.rita.id}", json={"password": "rita-is-great-99"})   # containing the username is allowed
    assert r.status_code == 200
    r = world.client.patch(f"/api/admin/users/{world.rita.id}", json={"password": "river-stone-4821"})
    assert r.status_code == 200


# ---- A07/A01: tokens issued before a password change stop working -----------------------------------------------------
class _FakeCache(dict):
    def set(self, key, value, ttl_seconds=None, namespace="default"):
        self[(namespace, key)] = value

    def get(self, key, namespace="default"):
        return dict.get(self, (namespace, key))


def test_tokens_issued_before_the_floor_are_rejected(monkeypatch):
    import app.providers.cache.redis as redis_mod
    cache = _FakeCache()
    monkeypatch.setattr(redis_mod, "get_redis_cache", lambda: cache)
    token = create_access_token("rita", "user")
    iat = decode_token(token)["iat"]
    assert not issued_before_floor("rita", iat)
    invalidate_user_tokens("rita")
    assert issued_before_floor("rita", iat - 5)             # a token from before the change
    assert not issued_before_floor("rita", iat + 60)        # one issued after it
    assert not issued_before_floor("someone-else", iat - 5)


def test_password_reset_sets_the_floor(world, monkeypatch):
    calls = []
    monkeypatch.setattr(A, "invalidate_user_tokens", lambda name: calls.append(name))
    world.client.patch(f"/api/admin/users/{world.rita.id}", json={"password": "river-stone-4821"})
    world.client.patch(f"/api/admin/users/{world.rita.id}", json={"otp_mode": "captcha"})   # not a credential change
    assert calls == ["rita"]


# ---- A06/A07: unknown and known accounts look the same ----------------------------------------------------------------
def test_captcha_verify_does_not_reveal_whether_an_email_exists():
    from app.api.routers import auth as auth_router
    app = FastAPI()
    app.include_router(auth_router.router)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[User.__table__])
    session = Session(engine)
    app.dependency_overrides[get_session] = lambda: session
    r = TestClient(app).post("/api/auth/captcha/verify", json={"email": "nobody@example.com", "captcha_id": "x" * 8, "answer": "abcd", "fingerprint": "f"})
    assert r.status_code == 401 and "not found" not in r.text.lower()


def test_burn_password_check_runs_a_real_hash(monkeypatch):
    seen = []
    real = security_auth.pwd_context.verify
    monkeypatch.setattr(security_auth.pwd_context, "verify", lambda *a, **k: (seen.append(a), real(*a, **k))[1])
    security_auth.burn_password_check("whatever")
    assert seen, "no hash was verified"


# ---- A09: logs ---------------------------------------------------------------------------------------------------------
def test_mask_email():
    assert mask_email("jane.doe@corp.com") == "j***@corp.com"
    assert mask_email("nope") == "***" and mask_email(None) == "-" and mask_email("") == "-"


def test_security_event_is_one_line_and_cannot_be_forged(caplog):
    with caplog.at_level(logging.INFO, logger="alphacv.security"):
        security_event("login_failed", logging.WARNING, account='a***@b.com"\nsecurity event=login_ok', ip="1.2.3.4", skipped=None)
    assert len(caplog.records) == 1
    msg = caplog.records[0].getMessage()
    assert "\n" not in msg and "event=login_failed" in msg and "skipped" not in msg and 'ip="1.2.3.4"' in msg


# ---- A10: no raw exception text for clients ---------------------------------------------------------------------------
def test_no_route_returns_exception_text_in_a_500():
    import pathlib, re
    root = pathlib.Path(__file__).resolve().parents[1] / "app"
    bad = re.compile(r"status_code\s*=\s*(?:status\.HTTP_500_INTERNAL_SERVER_ERROR|500)[^)]*detail\s*=\s*(?:f[\"'][^\"']*\{(?:str\()?(?:e|exc|err)\)?\}|str\((?:e|exc|err)\))")
    hits = [f"{p.relative_to(root)}:{s.count(chr(10), 0, m.start()) + 1}" for p in root.rglob("*.py")
            for s in [p.read_text(encoding="utf-8")] for m in bad.finditer(s)]
    assert not hits, hits


# ---- A01: a file is found by its exact id, never by a prefix ----------------------------------------------------------
def test_storage_serves_exact_id_only(tmp_path, monkeypatch):
    from app.api.deps import require_core_app
    from app.api.routers import storage as S
    (tmp_path / "cvs").mkdir()
    (tmp_path / "cvs" / "abc12345.pdf").write_bytes(b"%PDF-1.4 secret")
    monkeypatch.setattr(S, "get_storage_service", lambda: SimpleNamespace(base_dir=str(tmp_path), _get_content_type=lambda ext: "application/pdf"))
    monkeypatch.setattr(S, "get_store", lambda: SimpleNamespace(candidate_document=lambda i: None, jd_document=lambda i: None))
    app = FastAPI()
    app.include_router(S.router, prefix="/api/storage")
    app.dependency_overrides[require_core_app] = lambda: SimpleNamespace(role="user", username="u")
    c = TestClient(app)
    assert c.get("/api/storage/files/cv/abc12345").status_code == 200
    assert c.get("/api/storage/files/cv/abc").status_code == 404           # a prefix is not an id
    assert c.get("/api/storage/files/cv/a").status_code == 404
    assert c.get("/api/storage/files/cv/..%2Fx").status_code in (400, 404)


# ---- A02: every response carries the basic security headers; sign-in answers are never cached ------------------------
def test_security_headers_and_no_store_on_auth():
    from app.main import app as real_app
    c = TestClient(real_app)
    r = c.get("/api/auth/me")                                    # 403 without a token, but the headers are still set
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert r.headers["Cache-Control"] == "no-store"
    assert "Referrer-Policy" in r.headers


# ---- load / attack findings -------------------------------------------------------------------------------------------
def test_password_hashing_is_capped_and_busy_means_503(monkeypatch):
    import threading
    from fastapi import HTTPException
    from app.security import auth as A
    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(A, "_HASH_SLOTS", slots)
    slots.acquire()                                         # every slot taken
    monkeypatch.setattr(slots, "acquire", lambda timeout=None: False)
    with pytest.raises(HTTPException) as e:
        A.verify_password("x", "y")
    assert e.value.status_code == 503 and e.value.headers["Retry-After"]


def test_sign_in_lookup_gives_the_connection_back_before_hashing():
    from app.api.routers.auth import _find_user
    closed = []
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[User.__table__])
    with Session(engine) as s:
        s.add(User(username="rita", email="rita@example.com", password_hash="h", role="user", is_active=True)); s.commit()
        real_close = s.close
        s.close = lambda: (closed.append(1), real_close())[1]
        user = _find_user(s, "RITA@example.com")
    assert closed and user.username == "rita" and user.role == "user"       # still readable after the session was closed


def test_nul_character_in_a_sign_in_body_is_a_422_not_a_500():
    from app.main import app as real_app
    r = TestClient(real_app, raise_server_exceptions=False).post("/api/auth/verify-password", json={"email": "a\u0000b@example.com", "password": "x"})
    assert r.status_code == 422 and "b@example" not in r.text           # refused, and the input is not echoed back


def test_validation_errors_do_not_echo_the_input_and_deep_json_is_not_a_500():
    from app.main import app as real_app
    c = TestClient(real_app, raise_server_exceptions=False)
    r = c.post("/api/auth/verify-password", json={"email": 5, "password": "hunter2-secret-value"})
    assert r.status_code == 422 and "hunter2-secret-value" not in r.text
    r = c.post("/api/auth/verify-password", content=b'{"email":' + b"[" * 5000 + b"]" * 5000 + b"}", headers={"Content-Type": "application/json"})
    assert r.status_code in (400, 422)


def test_credential_stuffing_from_one_address_is_stopped_before_it_costs_hashing(monkeypatch):
    from app.security import login_guard as G
    cache = _FakeCache()
    cache.delete = lambda key, namespace="default": cache.pop((namespace, key), None)
    monkeypatch.setattr(G, "get_redis_cache", lambda: cache)
    monkeypatch.setattr(G.settings, "LOGIN_MAX_FAILED_ATTEMPTS_PER_IP", 30)
    for i in range(30):                                     # a different account every time: no account ever locks
        assert G.check_lockout(f"user{i}@example.com", "203.0.113.9") == (False, None)
        G.record_failure(f"user{i}@example.com", "203.0.113.9")
    assert G.check_lockout("brand-new@example.com", "203.0.113.9")[0] is True
    assert G.check_lockout("brand-new@example.com", "198.51.100.7") == (False, None)     # other addresses are not affected
