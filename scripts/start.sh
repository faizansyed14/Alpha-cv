#!/usr/bin/env bash
###############################################################################
# AlphaCV, start script
#
# Usage: ./scripts/start.sh dev|local|prod [clean]
#   dev     → docker-compose.dev.yml  (.env.dev is created from .env.dev.example on first run)
#   local   → docker-compose.local.yml (everything in Docker volumes: Postgres + raw files; no S3/RDS;
#             .env.local is created from .env.local.example on first run)
#   prod    → docker-compose.prod.yml (.env.prod is created from .env.prod.example on first run)
#   clean   → optional: force a from-scratch rebuild (--no-cache --pull)
#
# Every run rebuilds ALL buildable images (backend, match-worker, background-worker,
# frontend) and recreates the frontend container so UI code changes are always
# picked up. A content fingerprint (FRONTEND_CACHEBUST) busts the Next.js build
# layer when src/ changes. Docker layer caching keeps an unchanged rebuild fast.
# Image-only services (postgres, qdrant, redis, nginx) are started as-is.
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
    ENV_EXAMPLE=".env.dev.example"
    ;;
  local)
    COMPOSE_FILE="docker-compose.local.yml"
    ENV_FILE=".env.local"
    ENV_EXAMPLE=".env.local.example"
    ;;
  prod)
    COMPOSE_FILE="docker-compose.prod.yml"
    ENV_FILE=".env.prod"
    ENV_EXAMPLE=".env.prod.example"
    ;;
  *)
    echo -e "${RED}Usage: $0 dev|local|prod [clean]${NC}" >&2
    exit 1
    ;;
esac

# First run: create the env file from its committed template, then stop so the CHANGE_ME values get filled in.
if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$ENV_EXAMPLE" ]; then
    echo -e "${RED}Missing $ENV_FILE and its template $ENV_EXAMPLE.${NC}" >&2
    exit 1
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo -e "${YELLOW}Created $ENV_FILE from $ENV_EXAMPLE.${NC}"
  if grep -q "CHANGE_ME" "$ENV_FILE"; then
    echo -e "${YELLOW}Fill in the CHANGE_ME values in $ENV_FILE (at least OPENAI_API_KEY and the secrets), then run this again.${NC}" >&2
    exit 1
  fi
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

source "$SCRIPT_DIR/lib/frontend_cachebust.sh"

FRONTEND_CACHEBUST="$(frontend_cachebust)"
export FRONTEND_CACHEBUST
echo -e "${YELLOW}Frontend cachebust: ${FRONTEND_CACHEBUST:0:12}…${NC}"

# 1) Build every buildable image up front (frontend always rebuilt when fingerprint changes).
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

# 3) Always recreate frontend so the freshly built image is what the browser hits.
case "$MODE" in
  dev)   FE_SERVICE="frontend-dev" ;;
  local) FE_SERVICE="frontend-local" ;;
  *)     FE_SERVICE="frontend" ;;
esac
echo -e "${YELLOW}Recreating $FE_SERVICE with latest image...${NC}"
$COMPOSE "${COMPOSE_BASE[@]}" up -d --force-recreate --no-deps "$FE_SERVICE"
# nginx resolves its upstreams once at start: tell it about the recreated frontend container.
$COMPOSE "${COMPOSE_BASE[@]}" exec -T "${FE_SERVICE/frontend/nginx}" nginx -s reload >/dev/null 2>&1 || true

echo
$COMPOSE "${COMPOSE_BASE[@]}" ps
echo -e "${GREEN}AlphaCV ($MODE) started. Volumes are preserved across restarts.${NC}"
if [ "$MODE" = "dev" ] || [ "$MODE" = "local" ]; then
  echo "   Frontend: http://localhost:3000   API: http://localhost:8000   Nginx: http://localhost"
  echo "   Tip: UI changes need this start (frontend is baked into the image)."
fi
if [ "$MODE" = "local" ]; then
  echo "   Data lives in Docker volumes (alpha-cv-local_*). Reset everything with: ./scripts/clean.sh local"
fi
