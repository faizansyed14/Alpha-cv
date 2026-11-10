# AlphaCV, AI-powered ATS (CV analysis, matching & candidate tracking)

CPU-only, fully environment-driven deployment. FastAPI backend, Next.js
frontend, Postgres + Qdrant + Redis, nginx in front.

## Quick start

```bash
# Production
# first run creates .env.prod from .env.prod.example: fill in every CHANGE_ME + your domain/keys, run again
./scripts/start.sh prod         # always rebuilds every image; add `clean` for a --no-cache build
./scripts/stop.sh prod          # never deletes volumes

# Development
# first run creates .env.dev from .env.dev.example (S3 + RDS): fill it in, run again
./scripts/start.sh dev          # frontend :3000, api :8000, nginx :80
./scripts/start.sh local        # same as dev, but Postgres + raw files live in Docker volumes (no S3 / RDS)
./scripts/stop.sh dev
```

All configuration lives in `.env.local` / `.env.dev` / `.env.prod` (git-ignored, they hold secrets). The committed `.env.local.example`, `.env.dev.example` and
`.env.prod.example` are their templates: `start.sh` copies the right one on first run, and every
variable is documented with comments in it. The backend refuses to start in production with
default secrets, and `start.sh prod` refuses to run while `CHANGE_ME`
placeholders remain.

## Layout

| Path | Contents |
|------|----------|
| `backend/` | FastAPI app, packaged by function: `app/api/routers` (HTTP), `matching/`, `ingestion/`, `jobs/` (queues + workers), `providers/` (embeddings, llm, vectorstore, cache, storage), `integrations/email/`, `security/`; `app/config/settings.py` = single source of config truth. `model_server/` = the embedding-model container (see `backend/ARCHITECTURE.md`) |
| `frontend/` | Next.js 15 app (zustand stores, axios client in `src/lib/api.ts`) |
| `docker-compose.prod.yml` / `docker-compose.dev.yml` | The two deployment stacks (CPU-only) |
| `scripts/` | `start.sh` / `stop.sh` / `clean.sh`, `backup.sh` / `restore.sh` (see `docs/BACKUP_AND_RECOVERY.md`), `system/setup-ssl.sh`, `utils/` dataset builders |
| `scripts/db/` | RDS bootstrap SQL, Qdrant collection init and rebuild, store audit, guarded data reset (operations tools; the application's own database code is `backend/app/db/`) |
| `backend/migrations/` | Alembic: one migration history for the whole database (`alembic upgrade head`; the app applies it at startup) |
| `nginx/` | `nginx.conf.template` (domain via `DOMAIN` env) + dev config |
| `docs/` | Documentation, including `docs/AUDIT_REPORT.md` (full audit + refactor log) |

## Testing

```bash
cd backend
python3 -m pytest tests/ --no-cov          # unit/integration suite
PYTHONPATH=. python3 tests/e2e_smoke.py    # offline end-to-end smoke test (dummy data)
cd ../frontend && npm run build
```

The smoke test runs the real app end-to-end (login → CV/JD upload → matching →
delete) using in-memory Qdrant and a stubbed OpenAI call, so it needs no
running services. Set `E2E_REAL_MODEL=1` to use the real embedding model.

## Key operational notes

- **Volumes** (`postgres_data`, `qdrant_data`, `redis_data`, `uploads_data`,
  `llm_cache`) hold all state. No script in this repo ever deletes them.
- `scripts/db/reset_data.sh local|dev|prod` wipes application data (keeps auth users and
  volumes) after an interactive confirmation.
- Matching is CPU-only, **queued**, and cached. `POST /api/match` enqueues a job
  on Redis and returns immediately (`is_queued=true` + `job_id`); the dedicated
  `match-worker` container runs the scoring so the API never blocks. Poll by
  re-POSTing the same request or via `GET /api/match/jobs/{job_id}`. There is no
  longer a 300-CV cap, the worker streams candidates in chunks; `MATCH_MAX_CVS`
  (default 5000, `0`=off) is only an absurd-request ceiling. Caches: per-text
  embedding cache (Redis), in-process TTL cache for the JD's data during a match, a Redis
  result cache keyed by (cv, jd, weights), and a per-`(jd,cv)` LLM-analysis
  cache. Knobs live in `.env.prod` / `.env.dev` under "Matching performance" / "Match job queue".
  See `docs/MATCHING_SCALABILITY.md` for the bottleneck analysis and the
  (negative) vector-sharding assessment.
- **File storage** is pluggable: `STORAGE_BACKEND=local` (default, docker
  volume) or `s3` (AWS S3 + `S3_BUCKET`; uses the EC2 instance role). Relational
  data (users, tracker, email) lives in ONE PostgreSQL database and moves to AWS RDS by changing
  `DATABASE_URL` in `.env.prod`, no code changes.
- **Email dedup**: processed email ids persist in Postgres, and each extracted
  CV stores a `content_sha256`, the same CV file arriving in another email is
  skipped, and applicant+job duplicates are rejected.
- **Schema migrations**: one Alembic history (`backend/migrations`) covers the single
  PostgreSQL database; the app runs `alembic upgrade head` at startup under a lock, and
  `cd backend && alembic revision --autogenerate -m "..."` creates the next one.
