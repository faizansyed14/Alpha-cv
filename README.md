# AlphaCV — AI-powered ATS (CV analysis, matching & candidate tracking)

CPU-only, fully environment-driven deployment. FastAPI backend, Next.js
frontend, Postgres + Qdrant + Redis, nginx in front.

## Quick start

```bash
# Production
cp .env.example .env            # fill in every CHANGE_ME + your domain/keys
./scripts/start.sh prod         # always rebuilds every image; add `clean` for a --no-cache build
./scripts/stop.sh prod          # never deletes volumes

# Development
cp .env.development.example .env.dev
./scripts/start.sh dev          # frontend :3000, api :8000, nginx :80
./scripts/stop.sh dev
```

All configuration lives in `.env` / `.env.dev` — see the example files for
every variable with comments. The backend refuses to start in production with
default secrets, and `start.sh prod` refuses to run while `CHANGE_ME`
placeholders remain.

## Layout

| Path | Contents |
|------|----------|
| `alpha-backend/` | FastAPI app. `app/services/` is grouped into `ai/` (embeddings, LLM, matching, parsing), `email/` (Graph intake, OTP, schedulers), `queue/` (job + public-CV queues), `storage/` (local/S3); `app/core/config.py` = single source of config truth |
| `cv-analyzer-frontend/` | Next.js 15 app (zustand stores, axios client in `src/lib/api.ts`) |
| `docker-compose.prod.yml` / `docker-compose.dev.yml` | The two deployment stacks (CPU-only) |
| `scripts/` | `start.sh` / `stop.sh` (+ `system/setup-ssl.sh`, `testing/`, `utils/` helpers) |
| `db/` | Postgres init (creates `auth_db`), Qdrant collection init, guarded data reset, `cleanup_old_cvs.py` retention tool |
| `alpha-backend/migrations/` | Alembic migrations (`alembic -n auth ...` / `alembic -n tracker ...`) |
| `nginx/` | `nginx.conf.template` (domain via `DOMAIN` env) + dev config |
| `docs/` | Documentation, including `docs/AUDIT_REPORT.md` (full audit + refactor log) |

## Testing

```bash
cd alpha-backend
python3 -m pytest tests/ --no-cov          # unit/integration suite
PYTHONPATH=. python3 tests/e2e_smoke.py    # offline end-to-end smoke test (dummy data)
cd ../cv-analyzer-frontend && npm run build
```

The smoke test runs the real app end-to-end (login → CV/JD upload → matching →
delete) using in-memory Qdrant and a stubbed OpenAI call, so it needs no
running services. Set `E2E_REAL_MODEL=1` to use the real embedding model.

## Key operational notes

- **Volumes** (`postgres_data`, `qdrant_data`, `redis_data`, `uploads_data`,
  `llm_cache`) hold all state. No script in this repo ever deletes them.
- `db/reset_data.sh dev|prod` wipes application data (keeps auth users and
  volumes) after an interactive confirmation.
- Matching is CPU-only, **queued**, and cached. `POST /api/match` enqueues a job
  on Redis and returns immediately (`is_queued=true` + `job_id`); the dedicated
  `match-worker` container runs the scoring so the API never blocks. Poll by
  re-POSTing the same request or via `GET /api/match/jobs/{job_id}`. There is no
  longer a 300-CV cap — the worker streams candidates in chunks; `MATCH_MAX_CVS`
  (default 5000, `0`=off) is only an absurd-request ceiling. Caches: per-text
  embedding cache (Redis), in-process TTL cache for Qdrant documents, a Redis
  result cache keyed by (cv, jd, weights), and a per-`(jd,cv)` LLM-analysis
  cache. Knobs live in `.env` under "Matching performance" / "Match job queue".
  See `docs/MATCHING_SCALABILITY.md` for the bottleneck analysis and the
  (negative) vector-sharding assessment.
- **File storage** is pluggable: `STORAGE_BACKEND=local` (default, docker
  volume) or `s3` (AWS S3 + `S3_BUCKET`; uses the EC2 instance role). Relational
  data (auth, tracker, email) moves to AWS RDS by changing `AUTH_DB_URL`,
  `TRACKER_DB_URL` and `POSTGRES_*` in `.env` — no code changes.
- **Retention**: `python3 db/cleanup_old_cvs.py --days 365 --dry-run` purges
  raw files + embeddings of old CVs while keeping searchable structured data,
  notes, dedup hashes, tracker/auth/email records. Embeddings regenerate
  automatically if a purged CV is matched again.
- **Email dedup**: processed email ids persist in Postgres, and each extracted
  CV stores a `content_sha256` — the same CV file arriving in another email is
  skipped, and applicant+job duplicates are rejected.
- **Schema migrations**: Alembic is wired for both relational DBs
  (`cd alpha-backend && alembic -n auth upgrade head`). Baseline revisions are
  included; the app still bootstraps tables on first run.
