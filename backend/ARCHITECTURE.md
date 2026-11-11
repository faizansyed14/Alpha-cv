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
│   │                           #   careers, notices, monitor, storage
│   ├── matching/               # engine.py (scoring), runner.py (job pipeline), llm_scoring.py
│   ├── ingestion/              # pipeline.py (THE way a CV enters: upload / job page),
│   │                           #   cv_parser.py (pdf/docx/doc/rtf/odt/html/txt/images), ocr.py (RapidOCR),
│   │                           #   preview.py (drawn page previews), llm_enhancement.py, skill_keywords.py
│   ├── monitoring/             # recorder.py (call sites -> Redis rollups), reader.py (Monitor page queries)
│   ├── jobs/                   # match_queue.py, public_cv_queue.py, job_queue.py + worker entrypoints
│   │                           #   (match_worker.py, background_worker.py)
│   ├── providers/              # adapters to external systems
│   │   ├── embeddings/         # service.py (EmbeddingService), remote.py (model-server client)
│   │   ├── llm/                # service.py (OpenAI standardisation + extraction)
│   │   ├── cache/              # redis.py (shared), memory.py (in-process)
│   │   └── storage/            # base.py, local.py, s3.py
│   ├── integrations/email/     # login OTP e-mail (Microsoft Graph)
│   ├── security/               # auth.py (hashing + JWT), captcha.py, login_guard.py
│   ├── services/               # careers_service, careers_helpers, locations_service, presence, auth_mode
│   ├── db/                     # database.py (the single engine + session, runs the Alembic migrations at startup)
│   ├── models/                 # SQL tables (talent.py: candidates, JDs, postings, applications)   └── schemas/   # request/response models
│   ├── store/                  # THE data layer: Postgres tables (candidates.py, jobs.py, stats.py) + Qdrant vectors only (vectors.py)
│   └── data/                   # static datasets (cities.json)
├── model_server/               # separate container: multilingual-e5-small on ONNX Runtime (no torch) behind POST /embed
├── migrations/                 # alembic (auth, agents, talent tables)
└── tests/
```

Dependency direction: `api` → `matching`/`ingestion`/`services`/`jobs` → `providers`/`security`/`db`. Routers
hold HTTP concerns only; nothing below `api` imports from it except `api/deps.py` consumers.

## Containers

| Service | Image | Role |
|---|---|---|
| backend | `backend` | uvicorn API |
| match-worker | same image | `python -m app.jobs.match_worker` – runs queued matches |
| background-worker | same image | `python -m app.jobs.background_worker` – public-CV queue |
| model-server | `alpha-model-server` | the only process with the embedding model (ONNX Runtime); shared by all of the above |
| redis / qdrant | upstream | queue + cache / vector store |

The backend image has no ML runtime, so it builds in seconds and its layers rarely change.

## Matching flow (concurrent users)

1. `POST /api/match` validates, then `jobs/match_queue.enqueue_match` (admission control: per-user and global
   limits → HTTP 429). An identical in-flight request re-attaches to the same job.
2. A match-worker runner takes a **slot** (a Redis lease; cap `MATCH_QUEUE_MAX_CONCURRENT_JOBS`), pops the job and
   runs `matching/runner.run_match` while a heartbeat renews the lease.
3. Candidates are streamed in chunks (`MATCH_CHUNK_SIZE`), structured CVs read from Postgres and vectors from Qdrant in batches
   (`MATCH_QDRANT_BATCH_SIZE`), texts embedded in batches via the model server.
4. Progress and the final result are written to Redis; the client polls `POST /api/match` / `GET /api/match/jobs/{id}`.
5. A crashed worker's lease expires; the janitor (in every worker) re-queues the job, up to `MATCH_JOB_MAX_ATTEMPTS`.
   SIGTERM drains running jobs for `MATCH_SHUTDOWN_GRACE_SECONDS` then hands them back.

## One flow for every CV

Uploads and job-page applications both call `ingestion/pipeline.ingest_cv`: read (OCR when
scanned) -> standardise (LLM) -> embed -> store (document, structured record, embeddings) -> link to the job when there
is one. A door differs only in `source` (`upload`, `website`) and in the facts it knows about the
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
stored result stay bounded. The top `LLM_MATCH_TOP_N` (30) are re-scored by the LLM in batches of `LLM_MATCH_BATCH_SIZE`
(10) running concurrently within `LLM_MATCH_CONCURRENCY`. If `LLM_MATCH_MIN_SCORE` (0-100, default 0 = off) is set,
candidates whose semantic score is below it are not sent to the LLM and keep their semantic score.

## Configuration

Everything comes from the env file (`.env.local`, `.env.dev` or `.env.prod`) through `app/config/settings.py`.

## Tests

`pytest` from `backend/` (`pip install -r requirements.txt` already includes the test tools). `tests/test_match_queue.py` and
`tests/test_remote_embedder.py` run without Redis, Qdrant or a model.

## Agentic mode (`app/agentic/`)

One assistant that can use the application's own features: post jobs, match candidates, review candidates, write interview
questions and LinkedIn posts, keep notes on candidates, open/close/edit job postings, add CVs and job
descriptions to the library, and (admins) read system health and AI token usage, answer token reset requests and set the notice. Switched on with the toggle at the top right
(`/agentic`, a full page). It follows the same shape as the `Al-ain-Rag-Enterprise` reference: guardrails first, a planner that
picks a specialist, specialists with narrow tool lists, hard limits, and a trace of what was done.

| Folder / file | Service |
|---|---|
| `guardrails/input_guard.py` | Fixed replies with NO model call: empty, too long, **any delete/remove request**, prompt injection, predefined small talk, off-topic |
| `guardrails/confirmation.py` | The write rule: a job is posted only after a plain "yes" to the draft just shown (checked in code) |
| `guardrails/output_guard.py` | Tool results wrapped as data (tags neutralised, contact details masked, cut); replies cleaned (no ids) |
| `routing/` | Which specialist: keyword rules -> sticky follow-up -> tiny router-model call only if unsure -> clarifying question |
| `specialists/` | jobs, matching, candidates, interview, linkedin, admin: each has its own prompt, tools and allowed roles |
| `tools/` | The tools. `gateway.py` is the only door to the app: in-process API calls as the signed-in user, in two tiers. Tools can GET and POST a few whitelisted paths; changes (PATCH/PUT/POST on listed paths) can only be made by `act()`, which only the confirmed-action executor calls. There is no DELETE anywhere. `propose_*` tools only put a change on screen (checked at import and in tests) |
| `actions/` | Confirmed actions. `flow.py` builds the proposal card (Confirm / Cancel), finds the one that is waiting (only while it is the latest message) and answers it in code; `catalog.py` holds each kind of change and the one endpoint call it makes. The details run are the ones SAVED with the proposal, never anything sent from the browser. The conversation history is the audit trail |
| `loop.py` | The bounded tool loop (steps, tools per step, result size, token budget before every call, no tools on the last step) |
| `models.py` | Model per role (router, act, write, fallback), all default to `LLM_MODEL` (Claude Haiku 5.5); one retry on the fallback |
| `orchestrator.py` | One turn end to end and the append-only save (`agent_conversation` with `agent = "assistant"`) |

Previews: cards open the original CV / job description in the same viewer the Database and Match pages use (the browser fetches the file as the signed-in user). Matching progress is polled by the card itself through `GET /api/agentic/match-status/{id}` (no model, no tokens). Buttons on one candidate or job send its id (`selection` `review` / `focus`), so two records with the same name are never mixed up.

Safety in layers: delete words are refused before any model; the model can only propose changes and nothing is changed until the person confirms; DELETE does not exist in the gateway; the person's own token
is used so role checks and row scoping still apply; cards shown to the person are built from application data, not from the
model's wording; tokens count against the same daily budget as the agent chats. Tests: `tests/test_agentic.py`.
