#!/usr/bin/env bash
# =============================================================================
# AlphaCV — application data reset (DANGEROUS, interactive).
#
# Deletes APPLICATION DATA ONLY:
#   - the two Qdrant vector collections (candidate_vectors, job_description_vectors) and any older collections
#   - every data table in Postgres: candidates, job descriptions, postings, applications, tracker, email records
#     (the user table and the migration history are KEPT)
#   - all Redis keys (caches, OTPs, queues)
#
# It NEVER touches docker volumes — services keep running and the backend
# recreates empty collections on next use.
#
# Usage: ./scripts/db/reset_data.sh local|dev|prod
# =============================================================================
set -Eeuo pipefail

MODE="${1:-}"
case "$MODE" in
  local)
    COMPOSE_FILE="docker-compose.local.yml"
    BACKEND_SVC="backend-local"
    QDRANT_SVC="qdrant-local"
    REDIS_SVC="redis-local"
    ;;
  dev)
    COMPOSE_FILE="docker-compose.dev.yml"
    BACKEND_SVC="backend-dev"
    QDRANT_SVC="qdrant-dev"
    REDIS_SVC="redis-dev"
    ;;
  prod)
    COMPOSE_FILE="docker-compose.prod.yml"
    BACKEND_SVC="backend"
    QDRANT_SVC="qdrant"
    REDIS_SVC="redis"
    ;;
  *)
    echo "Usage: $0 local|dev|prod" >&2
    exit 1
    ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

echo "This will DELETE ALL application data ($MODE stack): candidates, JDs, job postings,"
echo "applications, tracker data, email-processing records and caches."
echo "Auth users and docker volumes are preserved."
read -r -p "Type RESET to continue: " CONFIRM
if [ "$CONFIRM" != "RESET" ]; then
  echo "Aborted."
  exit 1
fi

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

echo "→ Dropping Qdrant collections..."
compose exec -T "$QDRANT_SVC" sh -c '
  for c in candidate_vectors job_description_vectors cv_documents cv_structured cv_embeddings jd_documents jd_structured jd_embeddings job_postings_structured job_postings_documents job_postings_embeddings applications_documents applications_structured applications_embeddings; do
    wget -q -O- --method=DELETE "http://localhost:6333/collections/$c" >/dev/null 2>&1 || true
    echo "  deleted (if existed): $c"
  done
'

echo "→ Truncating the data tables in Postgres (users and migration history kept)..."
# Through the backend, which already holds the database address (the local container, or RDS in dev and prod): no psql or Postgres container needed.
compose exec -T "$BACKEND_SVC" python - <<'PY'
from sqlalchemy import text

from app.db.database import engine

with engine.begin() as conn:
    names = [r[0] for r in conn.execute(text(
        "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename NOT IN ('user', 'alembic_version')"))]
    for name in names:
        conn.execute(text('TRUNCATE TABLE "%s" CASCADE' % name.replace('"', '""')))
        print("  truncated", name)
PY

echo "→ Flushing Redis..."
compose exec -T "$REDIS_SVC" redis-cli FLUSHALL >/dev/null

echo "Application data reset complete. Volumes untouched; backend will recreate"
echo "   empty Qdrant collections on next request (or run: python3 scripts/db/init_qdrant.py)."
