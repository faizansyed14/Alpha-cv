"""Dynamic security regression probe (OWASP-aligned), run against the real app.

Verifies the pen-test fixes hold end-to-end:
  - JWT: 'none'-alg / wrong-signature / tampered-payload tokens rejected
  - OTP: cryptographic 6-digit, wrong OTP never authenticates
  - Login lockout (429) after repeated failures
  - Email webhook disabled (404) without a configured secret
  - Unauthenticated access to protected endpoints rejected
  - Path traversal blocked on file endpoints

Offline harness (in-memory Qdrant, stubbed embeddings, sqlite DBs, in-mem Redis).
Run:  cd alpha-backend && PYTHONPATH=. python3 tests/dynamic_security_test.py
"""
import os
import sys

os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("OPENAI_API_KEY", "stub")
os.environ.setdefault("AUTH_DB_URL", "sqlite:///./sec_auth.db")
os.environ.setdefault("LLM_CACHE_DIR", "/tmp/llm_cache_sec")
os.environ.setdefault("LOCAL_STORAGE_DIR", "/tmp/sec_uploads")
os.environ.setdefault("CV_UPLOAD_DIR", "/tmp/sec_uploads/cv")
os.environ.setdefault("OTP_DISABLE_EMAIL", "true")
os.environ.setdefault("SECRET_KEY", "test-secret-key-at-least-32-bytes-long-xxxx")
os.environ.setdefault("LOGIN_MAX_FAILED_ATTEMPTS", "5")
os.environ.setdefault("LOGIN_LOCKOUT_SECONDS", "900")

import base64
import hashlib as _hashlib
import json

import jwt as _jwt
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
        return one(texts) if isinstance(texts, str) else _np.stack([one(t) for t in texts])

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
from app.core.config import settings

failures = []


def check(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        failures.append(name)


def main() -> int:
    from app.services.email.otp_service import get_otp_service
    otp = get_otp_service().generate_otp()
    check("OTP is cryptographic 6-digit", otp.isdigit() and len(otp) == 6, f"otp={otp}")

    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        check("admin login works", login.status_code == 200, f"status={login.status_code}")
        token = login.json().get("access_token", "")
        admin = {"Authorization": f"Bearer {token}"}

        forged = _jwt.encode({"sub": "admin", "role": "admin", "exp": 9999999999}, key="", algorithm="none")
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"})
        check("JWT none-alg rejected", r.status_code == 401, f"status={r.status_code}")

        wrong = _jwt.encode({"sub": "admin", "role": "admin", "exp": 9999999999}, key="attacker", algorithm="HS256")
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {wrong}"})
        check("JWT wrong-signature rejected", r.status_code == 401, f"status={r.status_code}")

        parts = token.split(".")
        body = json.loads(base64.urlsafe_b64decode(parts[1] + "=="))
        body["role"] = "superadmin"
        tampered = parts[0] + "." + base64.urlsafe_b64encode(json.dumps(body).encode()).decode().rstrip("=") + "." + parts[2]
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tampered}"})
        check("JWT tampered-payload rejected", r.status_code == 401, f"status={r.status_code}")

        for path in ("/api/cv/cvs", "/api/jd/jds", "/api/admin/users"):
            r = client.get(path)
            check(f"unauth blocked: {path}", r.status_code in (401, 403), f"status={r.status_code}")
        r = client.post("/api/match", json={"jd_id": "x"})
        check("unauth blocked: POST /api/match", r.status_code in (401, 403), f"status={r.status_code}")

        r = client.post("/api/email/webhook/email-received", json={})
        check("email webhook disabled w/o secret", r.status_code == 404, f"status={r.status_code}")

        r = client.get("/api/storage/files/cv/..%2f..%2fetc%2fpasswd", headers=admin)
        check("storage path traversal blocked", r.status_code in (400, 404), f"status={r.status_code}")

        # Login lockout after repeated failures (requires a working cache backend)
        client.post("/api/admin/users", headers=admin, json={
            "username": "victim", "password": "RightPass!234", "role": "user",
            "email": "victim@sec-test.org"})
        statuses = [
            client.post("/api/auth/verify-password", json={"username": "victim", "password": "wrong"}).status_code
            for _ in range(settings.LOGIN_MAX_FAILED_ATTEMPTS + 2)
        ]
        check("login lockout engages (429) after repeated failures", 429 in statuses,
              f"statuses={statuses}")

        # Wrong OTP never authenticates
        client.post("/api/admin/users", headers=admin, json={
            "username": "otpuser", "password": "RightPass!234", "role": "user",
            "email": "otpuser@sec-test.org"})
        client.post("/api/auth/verify-password", json={"username": "otpuser", "password": "RightPass!234"})
        client.post("/api/auth/send-otp", json={"username": "otpuser", "password": "RightPass!234"})
        wrong_otp = [
            client.post("/api/auth/verify-otp", json={"username": "otpuser", "otp": "000000"}).status_code
            for _ in range(8)
        ]
        check("wrong OTP never authenticates", all(s != 200 for s in wrong_otp), f"statuses={wrong_otp}")

    print()
    if failures:
        print(f"❌ {len(failures)} security checks failed: {failures}")
        return 1
    print("✅ All dynamic security checks passed")
    return 0


if __name__ == "__main__":
    if os.path.exists("sec_auth.db"):
        os.remove("sec_auth.db")
    sys.exit(main())
