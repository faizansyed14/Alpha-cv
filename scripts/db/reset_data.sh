#!/usr/bin/env bash
# =============================================================================
# AlphaCV — application data reset (DANGEROUS, interactive).
#
# Deletes APPLICATION DATA ONLY:
#   - the two Qdrant vector collections (candidate_vectors, job_description_vectors) and any older collections
#   - every data table in Postgres: candidates, job descriptions, postings, applications, email records
#     (the user table and the migration history are KEPT; with --users every account EXCEPT THE ADMIN is deleted too)
#   - all Redis keys (caches, OTPs, queues)
#
# The admin account is never deleted by this script, with or without --users.
#
# It NEVER touches docker volumes — services keep running and the backend
# recreates empty collections on next use.
#
# Usage: ./scripts/db/reset_data.sh local|dev|prod [--users]
# =============================================================================
set -Eeuo pipefail

MODE="${1:-}"
WITH_USERS=0
if [ "${2:-}" = "--users" ]; then WITH_USERS=1; elif [ -n "${2:-}" ]; then echo "Unknown option: $2" >&2; exit 1; fi
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
echo "applications, email-processing records and caches."
if [ "$WITH_USERS" = 1 ]; then echo "ALL accounts except the admin are deleted as well."; else echo "Auth users are preserved."; fi
echo "The admin account and the docker volumes are never touched."
read -r -p "Type RESET to continue: " CONFIRM
if [ "$CONFIRM" != "RESET" ]; then
  echo "Aborted."
  exit 1
fi

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

echo "→ Dropping the Qdrant collections and truncating the data tables..."
# Through the backend, which already holds the addresses of both stores (the local containers, or RDS in dev and prod): no psql, wget or
# Postgres client is needed on the host or in the store containers.
compose exec -T -e WITH_USERS="$WITH_USERS" "$BACKEND_SVC" python - <<'PY'
import os

from qdrant_client import QdrantClient
from sqlalchemy import text

from app.config.settings import settings
from app.db.database import engine

client = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT, api_key=settings.QDRANT_API_KEY or None)
for collection in client.get_collections().collections:
    client.delete_collection(collection.name)
    print("  dropped vector collection", collection.name)

with engine.begin() as conn:
    names = [r[0] for r in conn.execute(text(
        "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename NOT IN ('user', 'alembic_version')"))]
    for name in names:
        conn.execute(text('TRUNCATE TABLE "%s" CASCADE' % name.replace('"', '""')))
        print("  truncated", name)
    if os.environ.get("WITH_USERS") == "1":
        gone = conn.execute(text('DELETE FROM "user" WHERE role <> :keep'), {"keep": "admin"}).rowcount
        print("  deleted", gone, "non-admin account(s); the admin was kept")
    admins = conn.execute(text('SELECT count(*) FROM "user" WHERE role = :keep'), {"keep": "admin"}).scalar()
    print("  admin accounts present:", admins)
PY

echo "→ Flushing Redis..."
compose exec -T "$REDIS_SVC" redis-cli FLUSHALL >/dev/null

echo "Application data reset complete. Volumes untouched; backend will recreate"
echo "   empty Qdrant collections on next request (or run: python3 scripts/db/init_qdrant.py)."
