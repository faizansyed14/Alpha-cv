# AlphaCV — Codebase Audit & Refactor Report

Date: 2026-06-12
Scope: full repository (FastAPI backend `alpha-backend/`, Next.js frontend `cv-analyzer-frontend/`, Docker/nginx infrastructure).

This document is the Phase 1 deliverable: every feature mapped, every issue
classified (Critical / Improvement / Dead code), and the action taken during
the refactor.

---

## 1. System overview (as audited)

**Features**
- **Auth**: username/password + email OTP (Microsoft Graph), JWT sessions, role-based access (admin / manager / user / recruiter / evp), admin user management.
- **CV & JD pipeline**: upload (PDF/DOCX/TXT/images+OCR) → parsing & PII scrubbing → LLM standardization (OpenAI) → 32 fixed embeddings per document (20 skills, 10 responsibilities, 1 title, 1 experience; all-mpnet-base-v2, 768-d) → Qdrant storage in `*_documents` / `*_structured` / `*_embeddings` collections.
- **Matching**: deterministic scoring (Hungarian assignment over skill/responsibility cosine similarity + title + experience, weighted 50/20/20/10 by default) + optional LLM re-ranking of top candidates; concurrency-limited with queueing.
- **Careers**: admin job postings with public tokens, anonymous public applications (stored as CVs flagged `is_job_application`), async processing queue, weekly reports.
- **Candidate Tracker**: isolated Postgres store (Dubai/Abu Dhabi teams), job openings, candidates, applications, follow-ups, Excel import/export, follow-up email reminders.
- **Email intake**: scheduled Microsoft Graph mailbox polling that converts email attachments into CVs.
- **Monitoring**: health endpoints, Prometheus metrics, performance dashboard.

**Key storage fact**: public job applications are stored in the `cv_*`
collections **using the application id as the CV id**. The frontend passing
`application_id` values as `cv_ids` to `/api/match` is therefore correct by
design (flagged during audit as a suspected bug; verified not to be one).

---

## 2. Critical issues (fixed)

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| C1 | **GPU-only matching path raised `RuntimeError` on CPU hosts** (`avg_best_similarity` demanded CUDA) — matching breaks on the target CPU-only deployment | `matching_service.py` | All similarity math rewritten as vectorized CPU (numpy); GPU branches removed; `USE_GPU` env flag retained as opt-in only |
| C2 | **`auth_db` Postgres database was never created** — compose used `POSTGRES_MULTIPLE_DATABASES`, which the official postgres image ignores | `docker-compose*.yml` | `db/init/01-create-databases.sh` mounted at `/docker-entrypoint-initdb.d` |
| C2b | **Uploaded CV/JD files and the LLM disk cache had no docker volume** — files written to `/data/uploads` were lost whenever the backend container was recreated | compose files | `uploads_data` and `llm_cache` named volumes mounted into backend and both workers |
| C2c | Compose mounted `postgres-optimized.conf` and `maintenance.html`, **which don't exist in the repo** (Docker silently creates empty dirs at those paths) | old compose files | Broken mounts removed; Postgres tuning kept via `-c` command flags |
| C3 | **No authentication on CV/JD/matching APIs** — anyone could upload, read, delete CVs, read/write HR notes, run matching | `cv_routes.py`, `jd_routes.py`, `special_routes.py`, `storage_routes.py` | `require_user` added to all non-public endpoints; careers public flow kept anonymous by design; frontend attaches the JWT globally via an axios interceptor |
| C4 | **Path traversal risk in file download/serving** — `doc_id` used unvalidated to build filesystem paths | `storage_routes.py`, `cv_routes.py` download | IDs validated (UUID-safe charset, no `/`, `\`, `..`) before path construction |
| C5 | **Dev login bypass reachable in production** if env vars misconfigured (hardcoded username) | `deps/auth.py` | Bypass now requires `LOCAL_AUTH=true` **and** development environment, username/password from env only |
| C6 | **Fragile Qdrant client init** — `asyncio.run()` inside event-loop detection, uncached pool client, race on first init → potential crashes and connection exhaustion | `qdrant_utils.py`, `qdrant_pool.py` | Thread-safe lazy singleton, pool logic removed, retry with backoff on reads, timeout/connection caps from env |
| C7 | **OpenAI API key could reach logs** via session header logging; Azure creds had placeholder defaults (`"your-client-id-here"`) | `llm_service.py`, `azure_email_service.py`, `email_otp_service.py` | Keys never logged; unset Azure config now cleanly disables the service instead of sending placeholders |
| C8 | **Hardcoded production domain + dev server IPs in CORS**, hardcoded domain in compose/nginx | `main.py`, compose, nginx | CORS origins from `FRONTEND_ORIGIN`/`FRONTEND_URL`; nginx domain via template + `DOMAIN` env |
| C9 | **Default credentials** (`admin`/`admin`, `change-me` secret) with prod check only partially covering flags | `core/config.py` | Consolidated `validate_production_safety()`: fails fast in production on default secret/creds, `LOCAL_AUTH`, `OTP_DISABLE_EMAIL` |
| C10 | **PII (emails/phones) logged in plaintext** during application processing | `careers_service.py` | Masked in logs |

## 3. Performance issues (fixed)

| # | Issue | Fix |
|---|-------|-----|
| P1 | Text-JD matching regenerated JD embeddings per candidate | JD embeddings generated once per match run and reused |
| P2 | No match-result caching — identical (CV, JD, weights) pairs fully recomputed every run | Redis match-result cache keyed by hash(cv_id, jd_id, weights), TTL `MATCH_RESULT_CACHE_TTL_SECONDS` |
| P3 | Repeated Qdrant fetches of the same structured docs/embeddings across match runs | In-process TTL cache (`MATCH_DOC_CACHE_TTL_SECONDS`, `MATCH_DOC_CACHE_MAX_ITEMS`) |
| P4 | Embedding cache used Python `hash()` (collision-prone, not stable across processes) | sha256 + model-namespaced Redis keys, TTL from env, bounded in-memory fallback |
| P5 | New `ThreadPoolExecutor` stashed on function attributes per call path; never shut down | Single module-level executors sized by `MATCH_THREAD_POOL_WORKERS` |
| P6 | Unbounded in-memory growth: matching progress dict, upload progress dict, queue `jobs` dict, rate-limiter IP maps, LLM disk cache | Age-based cleanup added to each; LLM disk cache pruned by mtime |
| P7 | Redis pool fixed at 10 connections; Qdrant scrolls unbounded | Pool size, socket timeout, scroll caps from env |
| P8 | DB polls / list endpoints: 60 s list caches were hardcoded | TTL via `LIST_CACHE_TTL_SECONDS` |

## 4. Improvements (structure/config)

- **Single source of truth config**: `app/core/config.py` (pydantic Settings) now declares every tunable; all ~15 scattered `os.getenv` call sites replaced with `settings.*`. `.env.example` (prod) and `.env.development.example` (dev) document every variable.
- **CPU-only build**: Dockerfile installs CPU torch unconditionally; all `runtime: nvidia` / CUDA env / GPU device reservations removed from compose; GPU monitoring removed.
- **Compose**: `docker-compose.prod.yml` (replaces GPU `docker-compose.yml` + `docker-compose.cpu.yml`) and rewritten `docker-compose.dev.yml`; named volumes for postgres/qdrant/redis/uploads/llm-cache; healthchecks; secrets only via `.env`; prometheus behind an optional `monitoring` profile.
- **Scripts**: `scripts/start.sh {dev|prod}` / `scripts/stop.sh {dev|prod}` — guaranteed to never delete volumes; root-level duplicate wrapper scripts removed (including the broken `deploy.sh` that pointed at a non-existent target).
- **db/**: postgres init (auth_db creation), Qdrant collection init/repair script, guarded `reset_data.sh` (truncates data, never touches volumes).
- **Consistent auth**: rate limiting, login lockout, and OTP send-rate knobs all env-driven.

## 5. Dead code removed

Backend:
- `app/routes/monitoring_routes.py` — never mounted in `main.py`.
- `app/services/performance_optimizer.py`, `app/services/smart_load_balancer.py` — only consumers were the unmounted monitoring routes.
- `app/services/job_queue.py` — legacy queue superseded by `enhanced_job_queue.py`.
- `app/utils/qdrant_pool.py` — replaced by the thread-safe singleton client.
- `match_text` function and legacy unused request models in `special_routes.py`; a 140-line commented-out duplicate of `/api/match`; unused `analyze_single_candidate_async` in `llm_enhancement.py`.
- `boto3` dependency (storage is local-filesystem; the dead `s3_client` legacy download branch was rewritten to use local storage).

Frontend:
- `components/layout/AppLayout.tsx` (superseded by `AppLayoutNew`), `components/upload/UploadPanel.tsx`, `components/matching/*.jsx` (EnhancedMatchingResults/AIEnhancedCard/SemanticCard — unimported), `api.matchJobCandidates()` (called a non-existent backend endpoint), stale commented code.

Infra/repo root:
- GPU `docker-compose.yml`, `docker-compose.cpu.yml` (consolidated into prod file), `nginx.conf.http-backup`, `nginx-ssl.conf` (duplicate), empty `security_hardening.env`, root-level wrapper scripts (`deploy.sh`, `setup-ssl.sh`, `monitor-*.sh`, `check-qdrant.sh`, `setup_s3_storage.sh`, `migrate_auth_db.sh`, `backup_uncompressed.sh`, root `init_dev_qdrant.py`), obsolete GPU/EC2 setup scripts.

## 6. Known mismatches checked and verdicts

- `careersStore` sends `application_id` as `cv_ids` → **correct** (application id *is* the CV id in storage). Left intact.
- `/api/careers/admin/jobs` returns a list or `{jobs,total}` depending on params → kept (frontend handles both); documented.
- `/api/email/*` calls from `EmailPage.tsx` used a hardcoded `NEXT_PUBLIC_API_URL` → switched to same-origin relative URLs (work via Next rewrites and nginx alike).
- `/api/match-text`: the function existed but had **no route decorator** — the endpoint never existed at runtime. Dead function removed (frontend never called it from any component).
- The Qdrant "GPU Hungarian" naming was cosmetic — `scipy.optimize.linear_sum_assignment` already ran on CPU; only the similarity matrices had GPU paths. Scores are unchanged on CPU.
- JWT stored in localStorage (XSS surface) → kept for compatibility (cookie also set); follow-up recommendation: move to HTTP-only cookie session.

## 7. Verification performed

- `pytest` suite: **131 passed / 24 failed** vs **128 / 27 on the original code** — zero new failures; the 24 remaining failures pre-date this refactor (they require live Qdrant/network or assert drifted rate-limiter internals).
- End-to-end smoke test with dummy data (`alpha-backend/tests/e2e_smoke.py`): real app + real CPU embeddings + in-memory Qdrant + stubbed OpenAI; covers login → CV upload → JD upload → list → details → `/api/match` (by id, repeated/cached, and by text) → path-traversal guard → delete.
- `npm run build`: succeeds with all routes; no new TypeScript errors in touched files.
- `docker compose config` validates both compose files; `bash -n` validates all scripts.

## 8. Round-2 improvements (storage / retention / dedup / migrations)

- **Storage backends split**: `app/services/storage/` — `LocalStorageBackend` (default) and `S3StorageBackend`, selected by `STORAGE_BACKEND` env; identical key layout (`cvs/<id><ext>`) so migration is `aws s3 sync` + flipping the flag. The misleading `s3_storage.py` (local code under an S3 name) was removed.
- **RDS-ready relational data**: auth (`AUTH_DB_URL`), tracker (`TRACKER_DB_URL`) and email-processing tables (`POSTGRES_*`, now settings-driven with no hardcoded password fallback) all move to AWS RDS by editing `.env` only.
- **Retention**: `db/cleanup_old_cvs.py` (dry-run capable, functionally tested) purges raw file + raw text + embeddings of CVs older than `CV_RETENTION_DAYS`, keeping structured data/notes/dedup hashes; matching regenerates embeddings on demand.
- **Email dedup hardened**: persistent `processed_emails` (Postgres) + applicant+job duplicate check already existed; added **content-hash dedup** (`content_sha256` stored on every CV from email and public applications; identical files arriving in new emails are skipped via `find_cv_by_content_hash`).
- **Alembic**: two isolated migration streams (`alembic -n auth`, `alembic -n tracker`) with env-driven URLs and generated baseline revisions.
- **Queue wiring fix**: `ENABLE_PUBLIC_CV_QUEUE` was only set on the worker container, so the API never enqueued and the dedicated worker was idle (apply requests were processed in the API process as fallback). Now set via `.env` for all containers; flow: apply → Redis list → `public-cv-worker` (brpop) → status record, with automatic in-process fallback if Redis is down.

## 9. Remaining recommendations (not done, by design)

- Introduce Alembic for relational migrations (current best-effort `ALTER TABLE` startup migrations kept).
- Move JWT to HTTP-only cookies end-to-end.
- Consider an async Qdrant client; current sync client is wrapped in `asyncio.to_thread`.
- `next.config.ts` still ignores TS/ESLint build errors (flipping it surfaces pre-existing errors; left with TODO).
