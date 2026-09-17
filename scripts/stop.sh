#!/usr/bin/env bash
###############################################################################
# AlphaCV — stop script
#
# Usage: ./scripts/stop.sh dev|prod
#
# SAFETY: uses `docker compose down` WITHOUT -v. Volumes (postgres, qdrant,
# redis, uploads, llm cache) are NEVER deleted by this script.
###############################################################################
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

MODE="${1:-}"
case "$MODE" in
  dev)  COMPOSE_FILE="docker-compose.dev.yml"; ENV_FILE=".env.dev" ;;
  prod) COMPOSE_FILE="docker-compose.prod.yml"; ENV_FILE=".env" ;;
  *) echo "Usage: $0 dev|prod" >&2; exit 1 ;;
esac

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
else
  COMPOSE="docker-compose"
fi

ENV_ARGS=()
[ -f "$ENV_FILE" ] && ENV_ARGS=(--env-file "$ENV_FILE")

echo "Stopping AlphaCV ($MODE)... (volumes are preserved)"
$COMPOSE -f "$COMPOSE_FILE" "${ENV_ARGS[@]}" down
echo "✅ Stopped. Data volumes were NOT removed."
