#!/usr/bin/env bash
###############################################################################
# AlphaCV - rebuild ONLY the frontend
#
# Usage: ./scripts/frontend.sh [local|dev|prod] [clean]      (default: local)
#   clean   force a from-scratch frontend build (--no-cache --pull)
#
# Rebuilds the Next.js image, recreates just the frontend container and reloads
# nginx so it picks up the new container. The backend, workers, model server,
# databases and all volumes are left running and untouched.
###############################################################################
set -Eeuo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

MODE="${1:-local}"
CLEAN="${2:-}"

case "$MODE" in
  local) COMPOSE_FILE="docker-compose.local.yml"; ENV_FILE=".env.local"; SERVICE="frontend-local"; NGINX="nginx-local" ;;
  dev)   COMPOSE_FILE="docker-compose.dev.yml";   ENV_FILE=".env.dev";   SERVICE="frontend-dev";   NGINX="nginx-dev" ;;
  prod)  COMPOSE_FILE="docker-compose.prod.yml";  ENV_FILE=".env";       SERVICE="frontend";       NGINX="nginx" ;;
  *) echo -e "${RED}Usage: $0 [local|dev|prod] [clean]${NC}" >&2; exit 1 ;;
esac

[ -f "$ENV_FILE" ] || { echo -e "${RED}Missing $ENV_FILE. Run ./scripts/start.sh $MODE first.${NC}" >&2; exit 1; }

if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="docker-compose"; fi
COMPOSE_BASE=(-f "$COMPOSE_FILE" --env-file "$ENV_FILE")

source "$SCRIPT_DIR/lib/frontend_cachebust.sh"
FRONTEND_CACHEBUST="$(frontend_cachebust)"
export FRONTEND_CACHEBUST
echo -e "${YELLOW}Frontend fingerprint: ${FRONTEND_CACHEBUST:0:12}${NC}"

BUILD_ARGS=(build)
if [ "$CLEAN" = "clean" ]; then
  echo -e "${YELLOW}Clean build: --no-cache --pull${NC}"
  BUILD_ARGS+=(--no-cache --pull)
fi

START=$(date +%s)
echo -e "${YELLOW}Building $SERVICE ($MODE)...${NC}"
$COMPOSE "${COMPOSE_BASE[@]}" "${BUILD_ARGS[@]}" "$SERVICE"

echo -e "${YELLOW}Recreating $SERVICE only...${NC}"
$COMPOSE "${COMPOSE_BASE[@]}" up -d --no-deps --force-recreate "$SERVICE"

# nginx resolves its upstreams once at start, so it must learn the new container's address.
if $COMPOSE "${COMPOSE_BASE[@]}" ps --services --status running 2>/dev/null | grep -qx "$NGINX"; then
  $COMPOSE "${COMPOSE_BASE[@]}" exec -T "$NGINX" nginx -s reload >/dev/null 2>&1 \
    && echo "nginx reloaded" || echo -e "${YELLOW}nginx reload skipped${NC}"
fi

echo
$COMPOSE "${COMPOSE_BASE[@]}" ps "$SERVICE"
echo -e "${GREEN}Frontend rebuilt in $(( $(date +%s) - START ))s. Nothing else was restarted.${NC}"
[ "$MODE" = "prod" ] || echo "   http://localhost:3000   (hard refresh the browser: Ctrl+Shift+R)"
