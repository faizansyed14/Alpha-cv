"""RBAC end-to-end test: create a user of each role, then assert each role's
access to core ATS endpoints vs the Candidate Tracker.

Focus: the new `account_manager` role must reach ONLY the tracker (plus
/auth/me and /features); all core pages (CV/JD/match/careers admin) must 403.

Offline harness (in-memory Qdrant, stubbed embeddings/LLM, sqlite DBs).
Run:  cd alpha-backend && PYTHONPATH=. python3 tests/test_rbac.py
"""
import os
import sys

os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("OPENAI_API_KEY", "stub")
os.environ.setdefault("AUTH_DB_URL", "sqlite:///./rbac_auth.db")
os.environ.setdefault("ENABLE_CANDIDATE_TRACKER", "true")
os.environ.setdefault("TRACKER_DB_URL", "sqlite:///./rbac_tracker.db")
os.environ.setdefault("ENABLE_APPLICATION_QUEUE", "false")
os.environ.setdefault("LLM_CACHE_DIR", "/tmp/llm_cache_rbac")
os.environ.setdefault("LOCAL_STORAGE_DIR", "/tmp/rbac_uploads")
os.environ.setdefault("CV_UPLOAD_DIR", "/tmp/rbac_uploads/cv")
os.environ.setdefault("OTP_DISABLE_EMAIL", "true")  # dev: OTP/CAPTCHA codes returned in responses

import hashlib as _hashlib

import numpy as _np
from qdrant_client import QdrantClient


class _FakeST:
    DIM = 768

    def encode(self, texts, convert_to_tensor=False, batch_size=32, show_progress_bar=False):
        def one(t):
            v = _np.zeros(self.DIM, dtype=_np.float32)
            for tok in str(t).lower().split():
                v[int(_hashlib.md5(tok.encode()).hexdigest(), 16) % self.DIM] += 1.0
            n = _np.linalg.norm(v)
            return v / n if n else v
        if isinstance(texts, str):
            return one(texts)
        return _np.stack([one(t) for t in texts])

    def get_sentence_embedding_dimension(self):
        return self.DIM


import app.services.ai.embedding_service as emb_mod
emb_mod._shared_model = _FakeST()
emb_mod._model_device = "cpu"

import app.utils.qdrant_utils as qu
_mem = QdrantClient(":memory:")


def _client(self):
    if self._client is None:
        self._client = _mem
        self._ensure_collections_exist()
    return self._client


qu.QdrantUtils.client = property(_client)

from fastapi.testclient import TestClient
from app.main import app

failures = []


def check(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        failures.append(name)


# Roles to create and their login style. Non-admin roles use OTP (fixed code).
ROLES = ["user", "manager", "evp", "account_manager"]


def login_admin(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def make_user(client, admin, username, role):
    r = client.post("/api/admin/users", headers=admin, json={
        "username": username, "password": "Passw0rd!234", "role": role,
        "email": f"{username}@rbac-test.org", "team_location": "dubai",
    })
    return r


def login_otp(client, username):
    client.post("/api/auth/verify-password", json={"username": username, "password": "Passw0rd!234"})
    r = client.post("/api/auth/send-otp", json={"username": username, "password": "Passw0rd!234"})
    otp = (r.json() or {}).get("dev_otp", "")  # dev-only: OTP returned when email disabled
    r = client.post("/api/auth/verify-otp", json={"username": username, "otp": otp})
    tok = (r.json() or {}).get("access_token", "")
    return {"Authorization": f"Bearer {tok}"} if tok else None


def login_captcha(client, username, password="Passw0rd!234", fp="test-fingerprint"):
    """Full CAPTCHA login flow: verify-password -> captcha -> captcha/verify."""
    vp = client.post("/api/auth/verify-password", json={"username": username, "password": password})
    mode = (vp.json() or {}).get("auth_mode")
    c = client.post("/api/auth/captcha", json={"username": username, "password": password, "fingerprint": fp})
    body = c.json() or {}
    answer = body.get("dev_code", "")
    r = client.post("/api/auth/captcha/verify", json={
        "username": username, "captcha_id": body.get("captcha_id"), "answer": answer, "fingerprint": fp,
    })
    tok = (r.json() or {}).get("access_token", "")
    return mode, body, {"Authorization": f"Bearer {tok}"} if tok else None


def main() -> int:
    with TestClient(app) as client:
        admin = login_admin(client)

        # 1. Admin can create a user of every role (including account_manager)
        headers = {}
        for role in ROLES:
            uname = f"u_{role}"
            r = make_user(client, admin, uname, role)
            check(f"create role={role}", r.status_code in (200, 201), f"status={r.status_code} {r.text[:120]}")
            if r.status_code in (200, 201):
                h = login_otp(client, uname)
                check(f"login role={role}", h is not None)
                headers[role] = h

        # 2. Invalid role is rejected by the schema
        r = make_user(client, admin, "u_bogus", "superuser")
        check("invalid role rejected", r.status_code == 422, f"status={r.status_code}")

        am = headers.get("account_manager")
        rec = headers.get("user")
        mgr = headers.get("manager")

        # 3. account_manager: allowed on shared endpoints
        if am:
            r = client.get("/api/auth/me", headers=am)
            check("account_manager /auth/me allowed", r.status_code == 200, f"status={r.status_code}")
            r = client.get("/api/features", headers=am)
            check("account_manager /features allowed", r.status_code == 200, f"status={r.status_code}")
            check("account_manager in features allowed_roles",
                  "account_manager" in (r.json().get("allowed_roles") or []))

            # 4. account_manager: BLOCKED (403) from all core ATS pages
            core_calls = [
                ("GET /api/cv/cvs", client.get("/api/cv/cvs", headers=am)),
                ("GET /api/jd/jds", client.get("/api/jd/jds", headers=am)),
                ("POST /api/match", client.post("/api/match", headers=am, json={"jd_id": "x", "cv_ids": ["y"]})),
                ("GET /api/careers/admin/jobs", client.get("/api/careers/admin/jobs", headers=am)),
                ("GET /api/system-stats", client.get("/api/system-stats", headers=am)),
            ]
            for label, resp in core_calls:
                check(f"account_manager blocked: {label}", resp.status_code == 403, f"status={resp.status_code}")

            # 5. account_manager: CAN read the tracker and write follow-ups
            r = client.get("/api/tracker/job-openings", headers=am)
            check("account_manager tracker read allowed", r.status_code == 200, f"status={r.status_code}")
            r = client.post("/api/tracker/follow-ups", headers=am, json={
                "client_name": "Acme", "current_stage": "Feedback Pending"})
            check("account_manager follow-up write allowed", r.status_code in (200, 201), f"status={r.status_code} {r.text[:120]}")
            # account_manager now has FULL tracker write access (manager-level), incl. job openings
            r = client.post("/api/tracker/job-openings", headers=am, json={"title": "AM Opening", "status": "Open"})
            check("account_manager job-opening write allowed", r.status_code in (200, 201), f"status={r.status_code} {r.text[:120]}")

        # 6. recruiter (user): can use core pages, read tracker, but not tracker manager-writes
        if rec:
            r = client.get("/api/cv/cvs", headers=rec)
            check("recruiter core CV list allowed", r.status_code == 200, f"status={r.status_code}")
            r = client.get("/api/tracker/job-openings", headers=rec)
            check("recruiter tracker read allowed", r.status_code == 200, f"status={r.status_code}")
            r = client.post("/api/tracker/job-openings", headers=rec, json={"title": "X"})
            check("recruiter job-opening write denied", r.status_code == 403, f"status={r.status_code}")

        # 7. manager: core pages + tracker writes
        if mgr:
            r = client.get("/api/cv/cvs", headers=mgr)
            check("manager core CV list allowed", r.status_code == 200, f"status={r.status_code}")
            r = client.post("/api/tracker/job-openings", headers=mgr, json={"title": "SRE", "status": "Open"})
            check("manager job-opening write allowed", r.status_code in (200, 201), f"status={r.status_code} {r.text[:120]}")

        # 8. admin: everything (spot-check a core + tracker + admin endpoint)
        r = client.get("/api/cv/cvs", headers=admin)
        check("admin core CV list allowed", r.status_code == 200, f"status={r.status_code}")
        r = client.get("/api/admin/users", headers=admin)
        check("admin user list allowed", r.status_code == 200, f"status={r.status_code}")

        # 9. CAPTCHA auth mode: create a captcha-mode user (no email needed) and log in via CAPTCHA
        r = make_user(client, admin, "u_captcha", "user")
        # captcha users don't need email — set mode via update
        if r.status_code in (200, 201):
            uid = r.json()["id"]
            client.patch(f"/api/admin/users/{uid}", headers=admin, json={"otp_mode": "captcha"})
            r = client.get("/api/admin/users", headers=admin)
            cu = next((u for u in r.json() if u["username"] == "u_captcha"), None)
            check("captcha user otp_mode persisted", cu and cu.get("otp_mode") == "captcha", str(cu))

            fp = "test-fingerprint"
            vp = client.post("/api/auth/verify-password", json={"username": "u_captcha", "password": "Passw0rd!234"})
            check("verify-password returns auth_mode=captcha", (vp.json() or {}).get("auth_mode") == "captcha", str(vp.json()))
            # one challenge: test wrong answer (rejected, not consumed) then correct answer (login)
            c = client.post("/api/auth/captcha", json={"username": "u_captcha", "password": "Passw0rd!234", "fingerprint": fp})
            cbody = c.json() or {}
            check("captcha challenge has image", str(cbody.get("image", "")).startswith("data:image/png;base64,"))
            cid = cbody.get("captcha_id")
            bad = client.post("/api/auth/captcha/verify", json={
                "username": "u_captcha", "captcha_id": cid, "answer": "WRONG1", "fingerprint": fp})
            check("wrong captcha rejected", bad.status_code == 401, f"status={bad.status_code}")
            # wrong fingerprint rejected
            badfp = client.post("/api/auth/captcha/verify", json={
                "username": "u_captcha", "captcha_id": cid, "answer": cbody.get("dev_code", ""), "fingerprint": "other-fp"})
            check("captcha fingerprint mismatch rejected", badfp.status_code == 401, f"status={badfp.status_code}")
            # correct answer + fingerprint logs in
            good = client.post("/api/auth/captcha/verify", json={
                "username": "u_captcha", "captcha_id": cid, "answer": cbody.get("dev_code", ""), "fingerprint": fp})
            check("captcha login succeeds", good.status_code == 200 and (good.json() or {}).get("access_token"), f"status={good.status_code}")
            if good.status_code == 200:
                ch = {"Authorization": f"Bearer {good.json()['access_token']}"}
                rme = client.get("/api/auth/me", headers=ch)
                check("captcha user /auth/me works", rme.status_code == 200, f"status={rme.status_code}")
        # 10. invalid otp_mode rejected by schema
        rbad = client.post("/api/admin/users", headers=admin, json={
            "username": "u_badmode", "password": "Passw0rd!234", "role": "user",
            "email": "x@x.org", "otp_mode": "fixed"})
        check("otp_mode=fixed rejected (removed)", rbad.status_code == 422, f"status={rbad.status_code}")

    print()
    if failures:
        print(f"❌ {len(failures)} RBAC checks failed: {failures}")
        return 1
    print("✅ All RBAC checks passed")
    return 0


if __name__ == "__main__":
    for f in ("rbac_auth.db", "rbac_tracker.db"):
        if os.path.exists(f):
            os.remove(f)
    sys.exit(main())
