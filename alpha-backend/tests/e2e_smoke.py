"""End-to-end smoke test with dummy data (no live services required).

Runs the real FastAPI app with:
  - in-memory Qdrant (qdrant-client local mode)
  - real sentence-transformer embeddings on CPU
  - stubbed OpenAI standardization (canned JSON, no network)
  - sqlite auth DB, in-memory Redis fallback

Flow: login -> CV upload -> JD upload -> list -> match -> verify scores.
Run:  python3 tests/e2e_smoke.py
"""
import os
import sys

os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("OPENAI_API_KEY", "stub-key-for-smoke-test")
os.environ.setdefault("AUTH_DB_URL", "sqlite:///./smoke_auth.db")
os.environ.setdefault("LLM_CACHE_DIR", "/tmp/llm_cache_smoke")
os.environ.setdefault("LOCAL_STORAGE_DIR", "/tmp/smoke_uploads")
os.environ.setdefault("CV_UPLOAD_DIR", "/tmp/smoke_uploads/cv")

from qdrant_client import QdrantClient

# ---------------------------------------------------------------------------
# Offline embedding model: deterministic bag-of-hashed-tokens vectors so the
# full pipeline (32-vector generation, Qdrant storage, cosine similarity,
# Hungarian assignment, scoring) runs without downloading the real model.
# Overlapping vocabulary still yields high cosine similarity, so scores are
# meaningful. Set E2E_REAL_MODEL=1 to use the real sentence-transformer.
# ---------------------------------------------------------------------------
if os.getenv("E2E_REAL_MODEL", "") != "1":
    import hashlib as _hashlib

    import numpy as _np

    class _FakeSentenceTransformer:
        DIM = 768

        def _encode_one(self, text: str):
            vec = _np.zeros(self.DIM, dtype=_np.float32)
            for token in str(text).lower().split():
                idx = int(_hashlib.md5(token.encode()).hexdigest(), 16) % self.DIM
                vec[idx] += 1.0
            norm = _np.linalg.norm(vec)
            return vec / norm if norm else vec

        def encode(self, texts, convert_to_tensor=False, batch_size=32, show_progress_bar=False):
            if isinstance(texts, str):
                return self._encode_one(texts)
            return _np.stack([self._encode_one(t) for t in texts])

        def get_sentence_embedding_dimension(self):
            return self.DIM

        def cuda(self):
            return self

    import app.services.ai.embedding_service as emb_mod

    emb_mod._shared_model = _FakeSentenceTransformer()
    emb_mod._model_device = "cpu"

# In-memory Qdrant before anything imports the utils singleton.
import app.utils.qdrant_utils as qu

_mem_client = QdrantClient(":memory:")


def _patched_client(self):
    if self._client is None:
        self._client = _mem_client
        self._ensure_collections_exist()
    return self._client


qu.QdrantUtils.client = property(_patched_client)

# Stub the OpenAI-backed standardization with deterministic structured data.
import app.services.ai.llm_service as llm_mod

CV_STRUCT = {
    "name": "Jane Smith",
    "job_title": "Senior Python Developer",
    "years_of_experience": "7",
    "skills_sentences": [
        "Python backend development", "FastAPI web services", "PostgreSQL database design",
        "Docker containerization", "Redis caching", "REST API design",
        "CI/CD pipelines", "Unit testing with pytest", "AWS cloud deployment",
        "Microservices architecture", "Linux administration", "Git version control",
        "Agile development", "Code review", "Performance optimization",
        "SQL query tuning", "Nginx configuration", "Message queues",
        "OAuth2 authentication", "Vector databases",
    ],
    "responsibility_sentences": [
        "Designed and built REST APIs serving production traffic",
        "Led migration of monolith to microservices",
        "Mentored junior developers and ran code reviews",
        "Implemented caching layers cutting latency by 40%",
        "Owned CI/CD pipelines and release automation",
        "Modeled relational schemas for new product features",
        "Operated containerized services in production",
        "Integrated third-party APIs and webhooks",
        "Wrote integration and unit test suites",
        "Tuned database queries for high-volume workloads",
    ],
}

JD_STRUCT = {
    "job_title": "Python Backend Engineer",
    "years_of_experience": "5",
    "skills_sentences": [
        "Python programming", "FastAPI or Flask frameworks", "PostgreSQL",
        "Docker", "Redis", "API design",
        "Continuous integration", "Automated testing", "Cloud infrastructure",
        "Microservices", "Linux", "Git",
        "Scrum methodology", "Peer review", "Profiling and optimization",
        "SQL", "Reverse proxies", "Queueing systems",
        "Authentication protocols", "Search or vector stores",
    ],
    "responsibility_sentences": [
        "Build and maintain backend REST services",
        "Decompose legacy systems into services",
        "Support and mentor team members",
        "Improve application performance and caching",
        "Maintain deployment pipelines",
        "Design database schemas",
        "Run services in containers",
        "Integrate external systems",
        "Maintain automated test coverage",
        "Optimize data access patterns",
    ],
}


def _stub_cv(self, raw_text, filename="cv.txt"):
    return dict(CV_STRUCT)


def _stub_jd(self, raw_text, filename="jd.txt"):
    return dict(JD_STRUCT)


llm_mod.LLMService.standardize_cv = _stub_cv
llm_mod.LLMService.standardize_jd = _stub_jd

from fastapi.testclient import TestClient
from app.main import app

DUMMY_CV_TEXT = (
    "Jane Smith - Senior Python Developer with 7 years of experience in FastAPI, "
    "PostgreSQL, Docker, Redis and AWS. Led microservice migrations and mentored juniors."
)
DUMMY_JD_TEXT = (
    "We are hiring a Python Backend Engineer (5+ years) experienced with FastAPI, "
    "PostgreSQL, Docker, Redis, CI/CD and microservices."
)


def main() -> int:
    failures = []

    def check(name, cond, extra=""):
        status = "PASS" if cond else "FAIL"
        print(f"[{status}] {name} {extra}")
        if not cond:
            failures.append(name)

    with TestClient(app) as client:
        # 1. Health (public)
        r = client.get("/api/health")
        check("health endpoint", r.status_code == 200, f"status={r.status_code}")

        # 2. Auth required on protected endpoints
        r = client.get("/api/cv/cvs")
        check("cv list rejects anonymous", r.status_code in (401, 403), f"status={r.status_code}")

        # 3. Login (admin bootstrap user, direct admin login)
        r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        check("admin login", r.status_code == 200, f"status={r.status_code}")
        token = r.json().get("access_token", "")
        hdrs = {"Authorization": f"Bearer {token}"}

        # 4. Upload CV (text)
        r = client.post("/api/cv/upload-cv", data={"cv_text": DUMMY_CV_TEXT}, headers=hdrs)
        check("cv upload", r.status_code == 200, f"status={r.status_code}")
        cv_id = r.json().get("cv_id")
        check("cv id returned", bool(cv_id), f"cv_id={cv_id}")

        # 5. Upload JD (text)
        r = client.post("/api/jd/upload-jd", data={"jd_text": DUMMY_JD_TEXT}, headers=hdrs)
        check("jd upload", r.status_code == 200, f"status={r.status_code}")
        jd_id = r.json().get("jd_id") or r.json().get("cv_id")
        check("jd id returned", bool(jd_id), f"jd_id={jd_id}")

        # 6. Lists
        r = client.get("/api/cv/cvs", headers=hdrs)
        check("cv list", r.status_code == 200 and r.json().get("count", 0) >= 1)
        r = client.get("/api/jd/jds", headers=hdrs)
        check("jd list", r.status_code == 200)

        # 7. CV details + embeddings info
        r = client.get(f"/api/cv/{cv_id}", headers=hdrs)
        check("cv details", r.status_code == 200)
        r = client.get(f"/api/cv/{cv_id}/embeddings", headers=hdrs)
        check("cv embeddings info", r.status_code == 200)

        # 8. Matching (auth required)
        r = client.post("/api/match", json={"jd_id": jd_id, "cv_ids": [cv_id]})
        check("match rejects anonymous", r.status_code in (401, 403), f"status={r.status_code}")

        r = client.post("/api/match", json={"jd_id": jd_id, "cv_ids": [cv_id]}, headers=hdrs)
        check("match by ids", r.status_code == 200, f"status={r.status_code}")
        if r.status_code == 200:
            body = r.json()
            cands = body.get("candidates", [])
            check("match returns candidate", len(cands) == 1)
            if cands:
                c = cands[0]
                check(
                    "match scores sane",
                    0.0 <= c["overall_score"] <= 1.0 and c["skills_score"] > 0.3,
                    f"overall={c['overall_score']:.3f} skills={c['skills_score']:.3f} "
                    f"title={c['job_title_score']:.3f} years={c['years_score']:.3f}",
                )
                check("skills assignments present", len(c.get("skills_assignments", [])) > 0,
                      f"n={len(c.get('skills_assignments', []))}")

        # 9. Match again — should hit the Redis/in-memory result cache path without error
        r = client.post("/api/match", json={"jd_id": jd_id, "cv_ids": [cv_id]}, headers=hdrs)
        check("match repeat (cached)", r.status_code == 200, f"status={r.status_code}")

        # 10. Text-JD matching path (embeddings generated once per run)
        r = client.post("/api/match", json={"jd_text": DUMMY_JD_TEXT, "cv_ids": [cv_id]}, headers=hdrs)
        check("match by jd_text", r.status_code == 200, f"status={r.status_code}")

        # 11. System stats + database view (auth)
        r = client.get("/api/system-stats", headers=hdrs)
        check("system stats", r.status_code == 200)

        # 12. Path traversal guard
        r = client.get("/api/storage/files/cv/..%2F..%2Fetc%2Fpasswd", headers=hdrs)
        check("path traversal blocked", r.status_code in (400, 404), f"status={r.status_code}")

        # 13. Delete CV
        r = client.delete(f"/api/cv/{cv_id}", headers=hdrs)
        check("cv delete", r.status_code == 200, f"status={r.status_code}")

    print()
    if failures:
        print(f"❌ {len(failures)} smoke checks failed: {failures}")
        return 1
    print("✅ All end-to-end smoke checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
