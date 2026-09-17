#!/usr/bin/env bash
###############################################################################
# AlphaCV — start script
#
# Usage: ./scripts/start.sh dev|prod [clean]
#   dev     → docker-compose.dev.yml  (requires ./.env.dev)
#   prod    → docker-compose.prod.yml (requires ./.env)
#   clean   → optional: force a from-scratch rebuild (--no-cache --pull)
#
# Every run rebuilds ALL buildable images (backend, match-worker, email-scheduler,
# public-cv-worker, frontend) and recreates their containers so code changes are
# always picked up. Docker layer caching keeps an unchanged rebuild to a few
# seconds. Image-only services (postgres, qdrant, redis, nginx) are started as-is.
#
# SAFETY: this script never deletes docker volumes.
###############################################################################
set -Eeuo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

MODE="${1:-}"
# Accept "clean" or the legacy "rebuild" keyword for a no-cache build.
CLEAN="${2:-}"

case "$MODE" in
  dev)
    COMPOSE_FILE="docker-compose.dev.yml"
    ENV_FILE=".env.dev"
    ENV_EXAMPLE=".env.development.example"
    ;;
  prod)
    COMPOSE_FILE="docker-compose.prod.yml"
    ENV_FILE=".env"
    ENV_EXAMPLE=".env.example"
    ;;
  *)
    echo -e "${RED}Usage: $0 dev|prod [clean]${NC}" >&2
    exit 1
    ;;
esac

if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}Missing $ENV_FILE.${NC} Copy $ENV_EXAMPLE to $ENV_FILE and fill it in:" >&2
  echo "  cp $ENV_EXAMPLE $ENV_FILE" >&2
  exit 1
fi

if [ "$MODE" = "prod" ] && grep -q "CHANGE_ME" "$ENV_FILE"; then
  echo -e "${RED}Refusing to start: $ENV_FILE still contains CHANGE_ME placeholders.${NC}" >&2
  exit 1
fi

# Detect docker compose command
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo -e "${RED}docker compose not found${NC}" >&2
  exit 1
fi

COMPOSE_BASE=(-f "$COMPOSE_FILE" --env-file "$ENV_FILE")

# 1) Build every buildable image up front.
BUILD_ARGS=(build)
if [ "$CLEAN" = "clean" ] || [ "$CLEAN" = "rebuild" ]; then
  echo -e "${YELLOW}Clean rebuild: --no-cache --pull${NC}"
  BUILD_ARGS+=(--no-cache --pull)
fi
echo -e "${YELLOW}Building all images ($MODE)...${NC}"
$COMPOSE "${COMPOSE_BASE[@]}" "${BUILD_ARGS[@]}"

# 2) Start / recreate everything. --build re-checks images, --remove-orphans
#    drops containers for services no longer in the compose file.
echo -e "${YELLOW}Starting AlphaCV ($MODE) using $COMPOSE_FILE...${NC}"
$COMPOSE "${COMPOSE_BASE[@]}" up -d --build --remove-orphans

echo
$COMPOSE "${COMPOSE_BASE[@]}" ps
echo -e "${GREEN}✅ AlphaCV ($MODE) started. Volumes are preserved across restarts.${NC}"
if [ "$MODE" = "dev" ]; then
  echo "   Frontend: http://localhost:3000   API: http://localhost:8000   Nginx: http://localhost"
fi
