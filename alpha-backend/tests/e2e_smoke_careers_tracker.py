"""End-to-end smoke test #2: careers (job posting -> public page -> apply)
and candidate tracker (job openings, candidates, follow-ups).

Same offline harness as e2e_smoke.py: in-memory Qdrant, fake CPU embeddings,
stubbed OpenAI, sqlite auth/tracker DBs, in-memory Redis fallback.
Run:  PYTHONPATH=. python3 tests/e2e_smoke_careers_tracker.py
"""
import os
import sys
import time

os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("OPENAI_API_KEY", "stub-key-for-smoke-test")
os.environ.setdefault("AUTH_DB_URL", "sqlite:///./smoke2_auth.db")
os.environ.setdefault("ENABLE_CANDIDATE_TRACKER", "true")
os.environ.setdefault("TRACKER_DB_URL", "sqlite:///./smoke2_tracker.db")
os.environ.setdefault("ENABLE_APPLICATION_QUEUE", "false")  # inline/background apply path
os.environ.setdefault("LLM_CACHE_DIR", "/tmp/llm_cache_smoke2")
os.environ.setdefault("LOCAL_STORAGE_DIR", "/tmp/smoke2_uploads")
os.environ.setdefault("CV_UPLOAD_DIR", "/tmp/smoke2_uploads/cv")
os.environ.setdefault("OTP_DISABLE_EMAIL", "true")

import hashlib as _hashlib

import numpy as _np
from qdrant_client import QdrantClient


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


import app.services.ai.embedding_service as emb_mod

emb_mod._shared_model = _FakeSentenceTransformer()
emb_mod._model_device = "cpu"

import app.utils.qdrant_utils as qu

_mem_client = QdrantClient(":memory:")


def _patched_client(self):
    if self._client is None:
        self._client = _mem_client
        self._ensure_collections_exist()
    return self._client


qu.QdrantUtils.client = property(_patched_client)

import app.services.ai.llm_service as llm_mod

BOOLEAN_STR = '("DevOps Engineer" OR "SRE") AND (Kubernetes OR Docker) AND (Terraform OR Ansible)'
JD_STRUCT = {
    "job_title": "DevOps Engineer",
    "years_of_experience": "4",
    "boolean_search_string": BOOLEAN_STR,
    "skills_sentences": ["Kubernetes", "Terraform", "AWS", "CI/CD", "Python scripting",
                         "Monitoring", "Linux", "Networking", "Docker", "Git",
                         "Incident response", "Bash", "Helm", "Prometheus", "Grafana",
                         "Security hardening", "Cost optimization", "Load balancing",
                         "Service mesh", "GitOps"],
    "responsibility_sentences": ["Operate Kubernetes clusters", "Automate infrastructure with Terraform",
                                 "Maintain CI/CD pipelines", "Monitor production systems",
                                 "Respond to incidents", "Harden cloud security",
                                 "Optimize cloud costs", "Manage deployments",
                                 "Write automation scripts", "Document runbooks"],
}
CV_STRUCT = {
    "name": "Omar Hassan",
    "job_title": "DevOps Engineer",
    "years_of_experience": "5",
    "skills_sentences": JD_STRUCT["skills_sentences"][:18] + ["Ansible", "PostgreSQL"],
    "responsibility_sentences": JD_STRUCT["responsibility_sentences"],
}

llm_mod.LLMService.standardize_jd = lambda self, raw, filename="jd.txt": dict(JD_STRUCT)
llm_mod.LLMService.standardize_cv = lambda self, raw, filename="cv.txt": dict(CV_STRUCT)

from fastapi.testclient import TestClient
from app.main import app

failures = []


def check(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        failures.append(name)


def main() -> int:
    with TestClient(app) as client:
        # --- login as admin ---
        r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        check("admin login", r.status_code == 200, f"status={r.status_code}")
        admin = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # --- create a manager user (tracker writes require role=manager) ---
        r = client.post("/api/admin/users", headers=admin, json={
            "username": "mgr1", "password": "Mgr1Pass!234", "role": "manager",
            "email": "mgr1@alphadata-test.org", "team_location": "dubai",
        })
        check("create manager user", r.status_code in (200, 201), f"status={r.status_code} {r.text[:120]}")

        # --- OTP login flow for the manager ---
        r = client.post("/api/auth/verify-password", json={"username": "mgr1", "password": "Mgr1Pass!234"})
        check("manager verify-password", r.status_code == 200 and r.json().get("success"), f"status={r.status_code}")
        requires_otp = r.json().get("requires_otp", True)
        if requires_otp:
            r = client.post("/api/auth/send-otp", json={"username": "mgr1", "password": "Mgr1Pass!234"})
            check("manager send-otp (email disabled, dev code returned)", r.status_code == 200, f"status={r.status_code} {r.text[:120]}")
            dev_otp = (r.json() or {}).get("dev_otp", "")
            r = client.post("/api/auth/verify-otp", json={"username": "mgr1", "otp": dev_otp})
            check("manager verify-otp", r.status_code == 200, f"status={r.status_code} {r.text[:160]}")
            mgr = {"Authorization": f"Bearer {r.json().get('access_token', '')}"}
        else:
            r = client.post("/api/auth/login", json={"username": "mgr1", "password": "Mgr1Pass!234"})
            mgr = {"Authorization": f"Bearer {r.json().get('access_token', '')}"}

        # =====================================================================
        # CAREERS: post job -> public page -> public apply -> applications list
        # =====================================================================
        r = client.post("/api/careers/admin/jobs/post-manual", headers=admin, data={
            "job_title": "DevOps Engineer",
            "company_name": "Alpha Data",
            "location": "Dubai",
            "job_description": "We need a DevOps engineer with Kubernetes, Terraform, AWS, CI/CD.",
            "years_of_experience": "4",
            "skills": "Kubernetes, Terraform, AWS",
            "responsibilities": "Operate clusters; automate infra",
        })
        check("post job (manual)", r.status_code == 200, f"status={r.status_code} {r.text[:200]}")
        job = r.json()
        public_token = job.get("public_token") or job.get("job", {}).get("public_token")
        job_id = job.get("job_id") or job.get("id") or job.get("job", {}).get("id")
        check("job id + public token returned", bool(public_token) and bool(job_id),
              f"job_id={job_id} token={(public_token or '')[:12]}...")

        # public job page (anonymous)
        r = client.get(f"/api/careers/jobs/{public_token}")
        check("public job page (no auth)", r.status_code == 200, f"status={r.status_code}")
        check("public page has title", "DevOps" in r.text)

        # recent jobs (public openings page)
        r = client.get("/api/careers/jobs/recent")
        check("public recent jobs", r.status_code == 200, f"status={r.status_code}")

        # Naukri Gulf Boolean string shows on the admin careers job list
        r = client.get("/api/careers/admin/jobs", headers=admin)
        jobs_payload = r.json() if r.status_code == 200 else []
        jobs = jobs_payload.get("jobs", jobs_payload) if isinstance(jobs_payload, dict) else jobs_payload
        boolean_on_list = any((j.get("boolean_search_string") or "").startswith("(") for j in jobs)
        check("boolean search string on careers job list", r.status_code == 200 and boolean_on_list,
              f"status={r.status_code} sample={(jobs[0].get('boolean_search_string') if jobs else None)!r}")

        # Boolean string also available when viewing the JD in the database
        r = client.get(f"/api/jd/jd/{job_id}", headers=admin)
        if r.status_code == 200:
            jd_body = r.json().get("jd", {})
            bstr = jd_body.get("boolean_search_string") or jd_body.get("job_requirements", {}).get("boolean_search_string", "")
            check("boolean search string in JD detail", bool(bstr), f"value={bstr!r}")
        else:
            check("boolean search string in JD detail", False, f"jd detail status={r.status_code}")

        # anonymous application with a dummy CV file
        files = {"cv_file": ("omar_cv.txt", b"Omar Hassan - DevOps Engineer, 5 years: Kubernetes, Terraform, AWS, CI/CD", "text/plain")}
        r = client.post(f"/api/careers/jobs/{public_token}/apply", files=files, data={
            "applicant_name": "Omar Hassan",
            "applicant_email": "omar@example.test",
            "applicant_phone": "+971500000000",
            "expected_salary": "15000",
            "years_of_experience": "5",
        })
        check("public apply (no auth)", r.status_code == 200, f"status={r.status_code} {r.text[:200]}")
        application_id = r.json().get("application_id")
        check("application id returned", bool(application_id), f"id={application_id}")

        # application processing status endpoint (public)
        deadline = time.time() + 30
        status_val = None
        while time.time() < deadline:
            r = client.get(f"/api/careers/applications/{application_id}/status")
            if r.status_code == 200:
                status_val = (r.json().get("status") or "").lower()
                if status_val in ("completed", "processed", "success", "done"):
                    break
            time.sleep(1)
        check("application processed", status_val in ("completed", "processed", "success", "done"),
              f"status={status_val}")

        # admin: list applications for the job
        r = client.get(f"/api/careers/admin/jobs/{job_id}/applications", headers=admin)
        apps = r.json() if r.status_code == 200 else []
        app_list = apps.get("applications", apps) if isinstance(apps, dict) else apps
        check("applications list shows applicant", r.status_code == 200 and len(app_list) >= 1,
              f"status={r.status_code} n={len(app_list) if isinstance(app_list, list) else '?'}")

        # match the job's JD against the application (application_id == cv id)
        r = client.get(f"/api/careers/admin/jobs/{job_id}/match-data", headers=admin)
        check("job match-data", r.status_code == 200, f"status={r.status_code}")
        jd_id = (r.json() or {}).get("jd_id") or (r.json() or {}).get("job", {}).get("jd_id") or job_id
        r = client.post("/api/match", headers=admin, json={"jd_id": jd_id, "cv_ids": [application_id]})
        check("match job vs application", r.status_code == 200, f"status={r.status_code} {r.text[:160]}")
        if r.status_code == 200 and r.json().get("candidates"):
            c = r.json()["candidates"][0]
            check("application match score sane", c["overall_score"] > 0.3,
                  f"overall={c['overall_score']:.3f} skills={c['skills_score']:.3f}")
            # candidate card contact details (email/phone for recruiter outreach)
            check("candidate contact email present in match result",
                  bool(c.get("cv_email")), f"email={c.get('cv_email')!r}")
            check("candidate contact phone present in match result",
                  bool(c.get("cv_phone")), f"phone={c.get('cv_phone')!r}")

        # =====================================================================
        # TRACKER: job openings, candidates, applications, follow-ups
        # =====================================================================
        r = client.get("/api/features", headers=admin)
        check("features flag shows tracker", r.status_code == 200 and r.json().get("enable_candidate_tracker") is True,
              f"status={r.status_code} body={r.text[:120]}")

        r = client.post("/api/tracker/job-openings", headers=mgr, json={
            "title": "Site Reliability Engineer", "client": "Acme Corp", "status": "Open",
        })
        check("tracker create job opening (manager)", r.status_code in (200, 201), f"status={r.status_code} {r.text[:200]}")
        opening_id = (r.json() or {}).get("id")

        r = client.post("/api/tracker/job-openings", headers=admin, json={"title": "X"})
        check("tracker write denied for admin role", r.status_code == 403, f"status={r.status_code}")

        r = client.get("/api/tracker/job-openings", headers=admin)
        check("tracker list openings (admin can read)", r.status_code == 200, f"status={r.status_code}")

        r = client.post("/api/tracker/candidates", headers=mgr, json={
            "name": "Sara Ali", "email": "sara@example.test", "phone": "+971511111111",
        })
        check("tracker create candidate", r.status_code in (200, 201), f"status={r.status_code} {r.text[:200]}")
        cand_id = (r.json() or {}).get("id")

        if cand_id and opening_id:
            r = client.post("/api/tracker/applications", headers=mgr, json={
                "candidate_id": cand_id, "job_opening_id": opening_id, "status": "Submitted",
            })
            check("tracker create application", r.status_code in (200, 201), f"status={r.status_code} {r.text[:200]}")

        # follow-ups CRUD (any tracker role may write follow-ups)
        r = client.post("/api/tracker/follow-ups", headers=mgr, json={
            "client_name": "Acme Corp", "position": "Site Reliability Engineer",
            "current_stage": "Feedback Pending", "next_follow_up_date": "2026-06-20",
            "remarks": "call after interview",
        })
        check("tracker create follow-up", r.status_code in (200, 201), f"status={r.status_code} {r.text[:200]}")
        fu_id = (r.json() or {}).get("id")

        r = client.get("/api/tracker/follow-ups", headers=mgr)
        body = r.json() if r.status_code == 200 else []
        items = body.get("items", body) if isinstance(body, dict) else body
        check("tracker list follow-ups", r.status_code == 200 and len(items) >= 1,
              f"status={r.status_code} n={len(items) if isinstance(items, list) else '?'}")

        if fu_id:
            r = client.patch(f"/api/tracker/follow-ups/{fu_id}", headers=mgr, json={"current_stage": "Closed"})
            check("tracker update follow-up", r.status_code == 200, f"status={r.status_code} {r.text[:160]}")

        # Follow-up reminder email template (actual sending needs Azure Graph,
        # which is intentionally unset here). Verify the template renders.
        try:
            from app.services.email.followup_reminder_service import render_followup_email_html
            html = render_followup_email_html({
                "client_name": "Acme Corp", "position": "SRE",
                "next_follow_up_date": "2026-06-20", "current_stage": "Feedback Pending",
            })
            check("follow-up reminder email renders", bool(html) and "Acme" in html, f"len={len(html)}")
        except Exception as e:
            check("follow-up reminder email renders", False, str(e)[:120])

    print()
    if failures:
        print(f"❌ {len(failures)} checks failed: {failures}")
        return 1
    print("✅ All careers + tracker smoke checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
