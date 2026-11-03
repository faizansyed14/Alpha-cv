# Backend Architecture

FastAPI service for CV/JD ingestion, search and matching. Packages are named for what they do.

```
backend/
├── app/
│   ├── main.py                 # app factory: lifespan, middleware, router wiring
│   ├── config/                 # settings.py (single source of config), logging.py, rate_limits.py
│   ├── api/
│   │   ├── deps.py             # auth dependencies (require_core_app, require_admin, ...)
│   │   ├── middleware/         # request rate limiting
│   │   └── routers/            # HTTP layer only: auth, admin, cvs, job_descriptions, matching, system,
│   │                           #   careers, tracker, email, notices, monitor, storage, features
│   ├── matching/               # engine.py (scoring), runner.py (job pipeline), llm_scoring.py
│   ├── ingestion/              # pipeline.py (THE way a CV enters: upload / Naukri email / job page),
│   │                           #   cv_parser.py (pdf/docx/doc/rtf/odt/html/txt/images), ocr.py (RapidOCR),
│   │                           #   preview.py (drawn page previews), llm_enhancement.py, skill_keywords.py
│   ├── monitoring/             # recorder.py (call sites -> Redis rollups), reader.py (Monitor page queries)
│   ├── jobs/                   # match_queue.py, public_cv_queue.py, job_queue.py + worker entrypoints
│   │                           #   (match_worker.py, background_worker.py)
│   ├── providers/              # adapters to external systems
│   │   ├── embeddings/         # service.py (EmbeddingService), remote.py (model-server client)
│   │   ├── llm/                # service.py (OpenAI standardisation + extraction)
│   │   ├── vectorstore/        # qdrant.py
│   │   ├── cache/              # redis.py (shared), memory.py (in-process)
│   │   └── storage/            # base.py, local.py, s3.py
│   ├── integrations/email/     # Microsoft Graph intake, OTP, schedulers, follow-up reminders
│   ├── security/               # auth.py (hashing + JWT), captcha.py, login_guard.py
│   ├── services/               # careers_service, careers_helpers, locations_service, presence, auth_mode
│   ├── db/                     # auth_db.py, tracker_db.py (SQLModel engines + sessions)
│   ├── models/                 # SQL tables      └── schemas/   # request/response models
│   └── data/                   # static datasets (cities.json)
├── model_server/               # separate container: torch + sentence-transformer behind POST /embed
├── migrations/                 # alembic (auth, tracker)
└── tests/
```

Dependency direction: `api` → `matching`/`ingestion`/`services`/`jobs` → `providers`/`security`/`db`. Routers
hold HTTP concerns only; nothing below `api` imports from it except `api/deps.py` consumers.

## Containers

| Service | Image | Role |
|---|---|---|
| backend | `backend` | uvicorn API |
| match-worker | same image | `python -m app.jobs.match_worker` – runs queued matches |
| background-worker | same image | `python -m app.jobs.background_worker` – email scheduler + public-CV queue |
| model-server | `alpha-model-server` | the only process with torch; shared by all of the above |
| redis / qdrant | upstream | queue + cache / vector store |

The backend image has no ML runtime, so it builds in seconds and its layers rarely change.

## Matching flow (concurrent users)

1. `POST /api/match` validates, then `jobs/match_queue.enqueue_match` (admission control: per-user and global
   limits → HTTP 429). An identical in-flight request re-attaches to the same job.
2. A match-worker runner takes a **slot** (a Redis lease; cap `MATCH_QUEUE_MAX_CONCURRENT_JOBS`), pops the job and
   runs `matching/runner.run_match` while a heartbeat renews the lease.
3. Candidates are streamed in chunks (`MATCH_CHUNK_SIZE`), Qdrant payloads fetched in batches
   (`MATCH_QDRANT_BATCH_SIZE`), texts embedded in batches via the model server.
4. Progress and the final result are written to Redis; the client polls `POST /api/match` / `GET /api/match/jobs/{id}`.
5. A crashed worker's lease expires; the janitor (in every worker) re-queues the job, up to `MATCH_JOB_MAX_ATTEMPTS`.
   SIGTERM drains running jobs for `MATCH_SHUTDOWN_GRACE_SECONDS` then hands them back.

## One flow for every CV

Uploads, Naukri/email applications and job-page applications all call `ingestion/pipeline.ingest_cv`: read (OCR when
scanned) -> standardise (LLM) -> embed -> store (document, structured record, embeddings) -> link to the job when there
is one. A door differs only in `source` (`upload`, `email_application`, `website`) and in the facts it knows about the
candidate (job page: nationality, current location, notice period, expected salary ...). Those facts are **joined into the
CV's single record**: candidate-supplied values win over what the LLM read from the CV, blanks never overwrite, and the
same file arriving again (SHA-256) is merged into the existing record instead of being stored twice (unless that record
belongs to another job, in which case it is a new application). Matching then treats every CV identically.

## Monitoring

Every model call (LLM per purpose, embeddings, OCR), API request and finished match job is recorded fire-and-forget by
`monitoring/recorder.py` and rolled up per minute in Redis, so one Monitor page (`/monitor`, admins) covers the API and
every worker. It shows calls, errors, p50/p95 latency, tokens and estimated cost per call type, the recent LLM calls and
failures, the match queue, process heartbeats, Redis and host health, and alerts (failing LLM or jobs, no worker online,
backlog, evictions, budget). Metrics expire on their own and a Redis outage only drops metrics, never requests.

## Large matches

A match streams any number of CVs: ids first, structured CVs fetched one chunk ahead of scoring, results ranked as they
arrive. Full assignment detail is kept for the best `MATCH_DETAIL_TOP_N`; the rest keep scores only, so memory and the
stored result stay bounded. The top `LLM_MATCH_TOP_N` (50) are re-scored by the LLM in batches of `LLM_MATCH_BATCH_SIZE`
(10) running concurrently within `LLM_MATCH_CONCURRENCY`.

## Configuration

Everything comes from `.env` through `app/config/settings.py`. See `.env.example` for the full list.

## Tests

`pytest` from `backend/` (install `requirements-dev.txt`). `tests/test_match_queue.py` and
`tests/test_remote_embedder.py` run without Redis, Qdrant or a model.
