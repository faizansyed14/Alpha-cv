#!/usr/bin/env bash
# Shared by backup.sh and restore.sh: which compose file, env file and services belong to local | dev | prod, and how to reach the
# database and the vector store of that stack. Source it; it runs nothing by itself.
#
# What each stack keeps, and where (this decides what a backup has to copy):
#   local : Postgres in the postgres-local container (volume), raw CV/JD files in the uploads volume, Qdrant in its volume
#   dev   : Postgres on AWS RDS, raw files in S3, Qdrant in its volume
#   prod  : Postgres on AWS RDS, raw files in S3, Qdrant in its volume
# Redis only holds caches, one-time codes and the match queue: it is not backed up (a restart rebuilds it).

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
else
  DC=(docker-compose)
fi

die() { echo "ERROR: $*" >&2; exit 1; }
say() { echo "[$(date -u +%H:%M:%S)] $*"; }

# load_stack <local|dev|prod>: sets MODE, COMPOSE_FILE, ENV_FILE, BACKEND_SVC, PG_KIND (container|managed), FILES_KIND (volume|s3) and
# APP_SVCS (what to stop while data is replaced). COMPOSE_FILE / ENV_FILE / BACKEND_SVC / PG_SVC / APP_SVCS may be set in the
# environment first to point at a different stack (that is how the restore drill in docs/BACKUP_AND_RECOVERY.md runs).
load_stack() {
  MODE="${1:-}"
  case "$MODE" in
    local) : "${COMPOSE_FILE:=docker-compose.local.yml}"; : "${ENV_FILE:=.env.local}"; : "${BACKEND_SVC:=backend-local}"; : "${PG_SVC:=postgres-local}"
           : "${APP_SVCS:=frontend-local backend-local background-worker-local match-worker-local}"; PG_KIND=container; FILES_KIND=volume ;;
    dev)   : "${COMPOSE_FILE:=docker-compose.dev.yml}";   : "${ENV_FILE:=.env.dev}";   : "${BACKEND_SVC:=backend-dev}"; PG_SVC=""
           : "${APP_SVCS:=frontend-dev backend-dev background-worker-dev match-worker-dev}"; PG_KIND=managed; FILES_KIND=s3 ;;
    prod)  : "${COMPOSE_FILE:=docker-compose.prod.yml}";  : "${ENV_FILE:=.env.prod}";  : "${BACKEND_SVC:=backend}"; PG_SVC=""
           : "${APP_SVCS:=frontend backend background-worker match-worker}"; PG_KIND=managed; FILES_KIND=s3 ;;
    *) die "first argument must be local, dev or prod" ;;
  esac
  cd "$REPO_ROOT"
  [ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE not found"
  [ -f "$ENV_FILE" ] || die "$ENV_FILE not found (it holds this stack's database address and secrets)"
  COMPOSE=("${DC[@]}" -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
  PG_IMAGE="${PG_IMAGE:-postgres:15}"      # pg_dump / pg_restore must be at least as new as the RDS server (set PG_IMAGE=postgres:16 ...)
  MSYS_NO_PATHCONV=1; export MSYS_NO_PATHCONV
}

# env_get KEY: the value of KEY in the stack's env file (without an inline comment or quotes), or nothing.
env_get() {
  local line
  line="$(grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -1 || true)"
  line="${line#*=}"
  line="$(printf '%s' "$line" | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
  printf '%s' "$line"
}

# The compose project name (it prefixes the volume names).
project_name() { "${COMPOSE[@]}" config 2>/dev/null | sed -n 's/^name: //p' | head -1; }

# ---------------------------------------------------------------------------------------------------------------- Postgres
# The database of a managed stack is reached with a throwaway postgres container (it brings pg_dump / pg_restore / psql) and the address
# from DATABASE_URL; the address goes in through an environment variable, so it is not in the process list.
pg_uri() {
  local url; url="$(env_get DATABASE_URL)"
  [ -n "$url" ] || die "DATABASE_URL is not set in $ENV_FILE"
  printf '%s' "${url/postgresql+psycopg2:/postgresql:}"
}

pg_dump_to() {          # pg_dump_to <file>
  if [ "$PG_KIND" = container ]; then
    "${COMPOSE[@]}" exec -T "$PG_SVC" sh -c 'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$1"
  else
    docker run --rm -e "PGURI=$(pg_uri)" "$PG_IMAGE" sh -c 'pg_dump --format=custom --no-owner --no-privileges "$PGURI"' > "$1"
  fi
}

pg_restore_from() {     # pg_restore_from <file>   (replaces what the dump contains, in one transaction)
  if [ "$PG_KIND" = container ]; then
    "${COMPOSE[@]}" exec -T "$PG_SVC" sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$1"
  else
    docker run --rm -i -e "PGURI=$(pg_uri)" "$PG_IMAGE" sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction -d "$PGURI"' < "$1"
  fi
}

pg_list() {             # pg_list <file>: the table of contents of a dump (proves it is readable)
  docker run --rm -i "$PG_IMAGE" pg_restore --list < "$1"
}

pg_query() {            # pg_query "<sql>": one value per row, no headers
  if [ "$PG_KIND" = container ]; then
    "${COMPOSE[@]}" exec -T "$PG_SVC" sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' _ "$1" 2>/dev/null
  else
    docker run --rm -e "PGURI=$(pg_uri)" -e "SQL=$1" "$PG_IMAGE" sh -c 'psql -At "$PGURI" -c "$SQL"' 2>/dev/null
  fi
}

# ---------------------------------------------------------------------------------------------------------------- Qdrant
# Qdrant is reached through a one-off backend container (same network, same address and key as the app; nothing needs a published port).
# The helper script is passed as the program text, so stdin stays free for the snapshot data.
qdrant_tool() {         # qdrant_tool <command> [args...]
  "${COMPOSE[@]}" run --rm -T --no-deps "$BACKEND_SVC" python -c "$(cat "$REPO_ROOT/scripts/lib/qdrant_snapshot.py")" "$@"
}

# ---------------------------------------------------------------------------------------------------------------- files
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}
