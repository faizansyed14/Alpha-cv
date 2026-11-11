"""Run a fully self-contained demo backend for frontend testing.

Same offline harness as the smoke tests (in-memory Qdrant, deterministic fake
embeddings, stubbed OpenAI, sqlite auth DB) plus seeded demo data:
admin login admin/admin, several CVs and JDs, a published job posting with a
public application..

Usage:  cd backend && PYTHONPATH=. python3 tests/run_demo_server.py
Serves on http://localhost:8000, point the frontend at it via
BACKEND_INTERNAL_URL=http://localhost:8000 (next dev) and log in as admin/admin.
"""
import os

os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("OPENAI_API_KEY", "stub-key-for-demo")
os.environ["DATABASE_URL"] = "sqlite:///./demo_auth.db"      # always its own throwaway file, whatever the environment says: never a real database
os.environ["ADMIN_EMAIL"] = "admin@harness.test"        # the harness admin signs in with this (see harness_login.ADMIN_EMAIL)
os.environ["REDIS_HOST"], os.environ["REDIS_PORT"] = "127.0.0.1", "1"       # nothing listens there: the in-memory cache is used, never the real Redis
os.environ.setdefault("LOCAL_STORAGE_DIR", "/tmp/demo_uploads")
os.environ.setdefault("CV_UPLOAD_DIR", "/tmp/demo_uploads/cv")
os.environ.setdefault("OTP_DISABLE_EMAIL", "true")

import hashlib as _hashlib

import numpy as _np
from qdrant_client import QdrantClient


from app.config.settings import settings


class _FakeSentenceTransformer:
    DIM = settings.EMBEDDING_DIM

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


import app.providers.embeddings.service as emb_mod

emb_mod._shared_model = _FakeSentenceTransformer()
emb_mod._model_device = "cpu"

import app.store as _store_mod
from app.store import TalentStore
from app.store.vectors import VectorStore

_mem_client = QdrantClient(":memory:")
_store_mod._store = TalentStore(vectors=VectorStore(client=_mem_client))   # the vectors live in memory; the tables in the sqlite file

# Deterministic LLM stub: derive a plausible structure from the raw text.
import app.providers.llm.service as llm_mod

_PROFILES = [
    ("python", "Senior Python Developer",
     ["Python", "FastAPI", "PostgreSQL", "Docker", "Redis", "REST APIs", "CI/CD", "Pytest",
      "AWS", "Microservices", "Linux", "Git", "Agile", "Code review", "Optimization",
      "SQL", "Nginx", "Message queues", "OAuth2", "Vector databases"]),
    ("devops", "DevOps Engineer",
     ["Kubernetes", "Terraform", "AWS", "CI/CD", "Python scripting", "Monitoring", "Linux",
      "Networking", "Docker", "Git", "Incident response", "Bash", "Helm", "Prometheus",
      "Grafana", "Security", "Cost optimization", "Load balancing", "Service mesh", "GitOps"]),
    ("frontend", "Frontend Engineer",
     ["React", "TypeScript", "Next.js", "Tailwind CSS", "Redux", "Testing Library", "Vite",
      "GraphQL", "REST APIs", "Accessibility", "Webpack", "Git", "CI/CD", "Figma",
      "Performance", "SSR", "Node.js", "Jest", "Storybook", "Design systems"]),
    ("accountant", "Senior Accountant",
     ["IFRS", "Financial reporting", "Budgeting", "SAP", "Excel", "Auditing", "Tax compliance",
      "Accounts payable", "Accounts receivable", "Reconciliation", "Forecasting", "ERP systems",
      "Cash flow", "Payroll", "VAT", "Cost accounting", "Internal controls", "Analysis",
      "Month-end close", "Stakeholder reporting"]),
]


def _profile_for(text: str):
    t = text.lower()
    for key, title, skills in _PROFILES:
        if key in t:
            return title, skills
    return _PROFILES[0][1], _PROFILES[0][2]


def _stub_cv(self, raw_text, filename="cv.txt"):
    title, skills = _profile_for(raw_text)
    name = raw_text.split("-")[0].strip() if "-" in raw_text else "Demo Candidate"
    years = "7" if "senior" in raw_text.lower() else "4"
    handle = name.lower().split()[0] if name.split() else "candidate"
    return {
        "name": name, "job_title": title, "years_of_experience": years,
        "email": f"{handle}@demo.test",
        "phone": "+971 50 555 0100",
        "contact_info": {"email": f"{handle}@demo.test", "phone": "+971 50 555 0100"},
        "skills_sentences": skills,
        "responsibility_sentences": [f"Responsible for {s.lower()}" for s in skills[:10]],
    }


def _stub_jd(self, raw_text, filename="jd.txt"):
    title, skills = _profile_for(raw_text)
    top = [s for s in skills[:4]]
    boolean = f'"{title}" AND (' + " OR ".join(top[:2]) + ") AND (" + " OR ".join(top[2:4]) + ")"
    return {
        "job_title": title, "years_of_experience": "4",
        "boolean_search_string": boolean,
        "skills_sentences": skills,
        "responsibility_sentences": [f"Own {s.lower()}" for s in skills[:10]],
    }


llm_mod.LLMService.standardize_cv = _stub_cv
llm_mod.LLMService.standardize_jd = _stub_jd

from fastapi.testclient import TestClient
from app.main import app
from harness_login import ADMIN_EMAIL, login_with_captcha


def seed():
    with TestClient(app) as client:
        r = login_with_captcha(client, ADMIN_EMAIL, "admin")
        admin = {"Authorization": f"Bearer {r.json()['access_token']}"}

        cvs = [
            "Jane Smith - senior python developer with FastAPI, PostgreSQL, Docker, Redis",
            "Omar Hassan - devops engineer with Kubernetes, Terraform, AWS pipelines",
            "Maria Garcia - frontend engineer, React, TypeScript, Next.js, Tailwind",
            "Ahmed Khan - senior accountant, IFRS reporting, SAP, budgeting and audit",
        ]
        for text in cvs:
            client.post("/api/cv/upload-cv", data={"cv_text": text}, headers=admin)
        client.post("/api/jd/upload-jd", data={"jd_text": "Hiring a python developer (FastAPI, PostgreSQL, Docker)"}, headers=admin)
        client.post("/api/jd/upload-jd", data={"jd_text": "Hiring a devops engineer (Kubernetes, Terraform, AWS)"}, headers=admin)

        r = client.post("/api/careers/admin/jobs/post", headers=admin, data={
            "job_title": "Python Backend Engineer", "company_name": "Alpha Data",
            "location": "Dubai", "years_of_experience": "4",
            "job_description": "We are hiring a python developer with FastAPI and PostgreSQL.",
            "skills": "Python, FastAPI, PostgreSQL", "responsibilities": "Build APIs",
        })
        token = r.json().get("public_token")
        if token:
            client.post(f"/api/careers/jobs/{token}/apply",
                        files={"cv_file": ("jane_cv.txt", cvs[0].encode(), "text/plain")},
                        data={"applicant_name": "Jane Smith", "applicant_email": "jane@demo.test",
                              "applicant_phone": "+971501112233", "expected_salary": "18000",
                              "years_of_experience": "7"})

        # one more staff account (every non-admin role has the same access)
        client.post("/api/admin/users", headers=admin, json={
            "username": "manager", "password": "Manager!234", "role": "manager", "email": "manager@demo-org.org"})

        print("Demo data seeded")
        print(f"   {ADMIN_EMAIL} / admin")
        print("   manager@demo-org.org / Manager!234        (email OTP; dev returns code in response)")


if __name__ == "__main__":
    for f in ("demo_auth.db",):
        if os.path.exists(f):
            os.remove(f)
    seed()
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")
