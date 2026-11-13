"""Regression tests for the security review fixes (each one was reproduced against a running stack first)."""
import json
import time

import pytest
from fastapi.routing import APIRoute

from app.main import app


class _FakeRedis:
    """Just enough of RedisCacheService for the login guard and token revocation."""

    def __init__(self):
        self.data = {}

    def get(self, key, namespace="default"):
        item = self.data.get((namespace, key))
        if not item or item[1] < time.time():
            return None
        return item[0]

    def set(self, key, value, ttl_seconds=None, namespace="default"):
        self.data[(namespace, key)] = (value, time.time() + (ttl_seconds or 3600))
        return True

    def delete(self, key, namespace="default"):
        self.data.pop((namespace, key), None)
        return True


@pytest.fixture
def fake_redis(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr("app.providers.cache.redis.get_redis_cache", lambda: fake)
    monkeypatch.setattr("app.security.login_guard.get_redis_cache", lambda: fake)
    return fake


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/careers/admin/jobs/00000000-0000-0000-0000-000000000000/applications"),
    ("POST", "/api/careers/admin/jobs/00000000-0000-0000-0000-000000000000/extract-ui-data"),
])
def test_careers_admin_endpoints_require_login(test_client, method, path):
    """Applicant personal data and the LLM-backed JD extraction used to be reachable without a token."""
    assert test_client.request(method, path).status_code in (401, 403)


def test_bulk_destructive_endpoints_are_gone():
    """'Delete all job postings' and 'clear the whole database' no longer exist in the API."""
    paths = {(m, r.path) for r in app.routes if isinstance(r, APIRoute) for m in r.methods}
    assert ("DELETE", "/api/careers/admin/jobs/delete-all") not in paths
    assert ("POST", "/api/clear-database") not in paths


def test_logout_revokes_token(fake_redis):
    from app.security.auth import InvalidTokenError, create_access_token, decode_token, revoke_token

    token = create_access_token("someone", "user")
    assert decode_token(token)["sub"] == "someone"
    revoke_token(token)
    with pytest.raises(InvalidTokenError):
        decode_token(token)
    assert decode_token(create_access_token("someone", "user"))["sub"] == "someone"  # a new login still works


def test_lockout_is_per_client_not_per_account(fake_redis, monkeypatch):
    """Five bad passwords from one address must not lock the real user out from another address."""
    from app.config.settings import settings
    from app.security import login_guard

    monkeypatch.setattr(settings, "LOGIN_MAX_FAILED_ATTEMPTS", 5)
    monkeypatch.setattr(settings, "LOGIN_MAX_FAILED_ATTEMPTS_PER_ACCOUNT", 8)
    for _ in range(5):
        login_guard.record_failure("Admin", "198.51.100.66")
    assert login_guard.check_lockout("admin", "198.51.100.66")[0] is True
    assert login_guard.check_lockout("admin", "203.0.113.7")[0] is False
    # ...but guessing spread over many addresses still locks the account
    for i in range(3):
        login_guard.record_failure("admin", f"192.0.2.{i}")
    assert login_guard.check_lockout("admin", "203.0.113.7")[0] is True


def test_cv_list_ids_only_has_no_contact_data():
    import asyncio

    from app.api.routers.cvs import CV_LIST_PAGE, list_cvs
    from app.store import get_store

    store = get_store()
    for i in range(1, 251):
        store.save_candidate({"id": f"00000000-0000-0000-0000-{i:012d}", "content_sha256": f"{i:064d}", "filename": f"cv{i}.pdf",
                              "facts": {"full_name": "N", "email": f"e{i}@x.com", "phone": "1"}})

    def call(**kw):
        args = dict(limit=None, offset=0, category=None, categories=None, q=None, ids_only=False, cursor=None, _=None)
        args.update(kw)
        return json.loads(asyncio.run(list_cvs(**args)).body)

    page = call()
    assert len(page["cvs"]) == CV_LIST_PAGE == 200 and page["total"] == 250       # one page, never the whole database
    ids = call(ids_only=True)
    assert "cvs" not in ids and len(ids["ids"]) == 250 and "e1@x.com" not in json.dumps(ids)

    # the next page starts where the first one ended (cursor), with nothing repeated or skipped, and the total stays the exact count
    assert page["next_cursor"]
    rest = call(cursor=page["next_cursor"])
    assert len(rest["cvs"]) == 50 and rest["next_cursor"] is None and rest["total"] == 250
    assert [c["id"] for c in page["cvs"] + rest["cvs"]] == ids["ids"]


def test_public_health_hides_internals():
    from app.api.routers.system import _public_health

    full = {"status": "healthy", "timestamp": 1.0,
            "services": {"qdrant": {"status": "healthy", "host": "qdrant", "port": 6333}},
            "environment": {"openai_key_configured": True, "qdrant_host": "qdrant"}}
    public = _public_health(full)
    assert public == {"status": "healthy", "timestamp": 1.0, "services": {"qdrant": {"status": "healthy"}}}


@pytest.mark.parametrize("path", ["/api/cv/abc/preview", "/api/jd/jd/abc/preview"])
def test_document_previews_require_login(test_client, path):
    assert test_client.get(path).status_code in (401, 403)


def test_public_recent_jobs_do_not_expose_poster():
    """The unauthenticated /jobs/recent list must not reveal who posted a job."""
    import asyncio

    from app.api.routers import careers
    from app.store import get_store

    store = get_store()
    jd = store.save_job_description({"id": "jd1", "filename": "dev.pdf", "raw_text": "Dev", "standardized": {"job_title": "Dev"}})
    store.create_job_posting({"job_description_id": jd, "public_token": "tok1", "posted_by_user": "admin", "posted_by_role": "admin"})
    rows = asyncio.run(careers.get_recent_job_postings(limit=6))
    assert len(rows) == 1 and rows[0].job_title == "Dev"
    dumped = rows[0].model_dump() if hasattr(rows[0], "model_dump") else rows[0].dict()
    assert dumped.get("posted_by_user") in (None, "")
    assert dumped.get("posted_by_role") in (None, "")
