#!/usr/bin/env bash
# =============================================================================
# AlphaCV — application data reset (DANGEROUS, interactive).
#
# Deletes APPLICATION DATA ONLY:
#   - all Qdrant collections (CVs, JDs, job postings, applications, embeddings)
#   - tracker / email-processing tables in Postgres (auth users are KEPT)
#   - all Redis keys (caches, OTPs, queues)
#
# It NEVER touches docker volumes — services keep running and the backend
# recreates empty collections on next use.
#
# Usage: ./db/reset_data.sh dev|prod
# =============================================================================
set -Eeuo pipefail

MODE="${1:-}"
case "$MODE" in
  dev)
    COMPOSE_FILE="docker-compose.dev.yml"
    POSTGRES_SVC="postgres-dev"
    QDRANT_SVC="qdrant-dev"
    REDIS_SVC="redis-dev"
    ;;
  prod)
    COMPOSE_FILE="docker-compose.prod.yml"
    POSTGRES_SVC="postgres"
    QDRANT_SVC="qdrant"
    REDIS_SVC="redis"
    ;;
  *)
    echo "Usage: $0 dev|prod" >&2
    exit 1
    ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "This will DELETE ALL application data ($MODE stack): CVs, JDs, job postings,"
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
  for c in cv_documents cv_structured cv_embeddings jd_documents jd_structured jd_embeddings job_postings_structured job_postings_documents job_postings_embeddings applications_documents applications_structured applications_embeddings; do
    wget -q -O- --method=DELETE "http://localhost:6333/collections/$c" >/dev/null 2>&1 || true
    echo "  deleted (if existed): $c"
  done
'

echo "→ Truncating tracker/email tables in Postgres (auth users kept)..."
compose exec -T "$POSTGRES_SVC" sh -c '
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=0 <<SQL
DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema()
      AND tablename NOT IN ('users')
  LOOP
    EXECUTE format('TRUNCATE TABLE %I CASCADE', r.tablename);
    RAISE NOTICE 'truncated %', r.tablename;
  END LOOP;
END
\$\$;
SQL
'

echo "→ Flushing Redis..."
compose exec -T "$REDIS_SVC" redis-cli FLUSHALL >/dev/null

echo "✅ Application data reset complete. Volumes untouched; backend will recreate"
echo "   empty Qdrant collections on next request (or run: python3 db/init_qdrant.py)."
