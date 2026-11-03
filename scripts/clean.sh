#!/usr/bin/env bash
###############################################################################
# AlphaCV, clean script: remove one stack's containers, volumes and images
#
# Usage: ./scripts/clean.sh dev|local|prod [--yes] [--keep-images]
#
# Only resources that belong to THIS project are touched. They are found by the
# docker compose project label, so other projects on the same Docker (anything
# else you run) are never affected. Shared base images (postgres, redis, nginx,
# qdrant, python, node) are kept; they are reused by the next build.
#
# DESTRUCTIVE: volumes hold the stack's data (Postgres, Qdrant index, Redis,
# uploaded files). start.sh/stop.sh never delete them; this script does, after a
# confirmation (skip with --yes).
###############################################################################
set -Eeuo pipefail

MODE="${1:-}"
shift || true
ASSUME_YES=0; KEEP_IMAGES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --keep-images) KEEP_IMAGES=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

case "$MODE" in
  dev)   PROJECT="alpha-cv" ;;          # docker-compose.dev.yml has no name:, so Docker uses the folder name
  local) PROJECT="alpha-cv-local" ;;
  prod)  PROJECT="alpha-cv" ;;
  *) echo "Usage: $0 dev|local|prod [--yes] [--keep-images]" >&2; exit 1 ;;
esac
# The folder name is the project name for dev/prod: honour a different checkout folder name.
if [ "$MODE" != "local" ]; then
  PROJECT="$(basename "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9\n_-' '-')"
fi

FILTER="label=com.docker.compose.project=$PROJECT"
containers="$(docker ps -aq --filter "$FILTER")"
volumes="$(docker volume ls -q --filter "$FILTER")"
networks="$(docker network ls -q --filter "$FILTER")"
images=""
[ "$KEEP_IMAGES" = 1 ] || images="$(docker image ls -q --filter "$FILTER" | sort -u)"
# images this project builds and tags itself
if [ "$KEEP_IMAGES" = 0 ]; then
  for tag in "alpha-backend:$MODE" "alpha-model-server:$MODE"; do
    id="$(docker image ls -q "$tag" 2>/dev/null || true)"
    [ -n "$id" ] && images="$(printf '%s\n%s' "$images" "$id" | sort -u)"
  done
fi

echo "Project: $PROJECT"
echo "  containers: $(echo "$containers" | grep -c . || true)"
echo "  volumes   : $(docker volume ls --filter "$FILTER" --format '{{.Name}}' | tr '\n' ' ')"
echo "  networks  : $(echo "$networks" | grep -c . || true)"
echo "  images    : $(echo "$images" | grep -c . || true)"

if [ -z "$containers$volumes$networks$images" ]; then
  echo "Nothing to remove."
  exit 0
fi

if [ "$ASSUME_YES" = 0 ]; then
  read -r -p "Delete these, including ALL data in the volumes? Type 'delete' to continue: " answer
  [ "$answer" = "delete" ] || { echo "Cancelled."; exit 1; }
fi

[ -n "$containers" ] && docker rm -f $containers >/dev/null
[ -n "$networks" ]   && docker network rm $networks >/dev/null 2>&1 || true
[ -n "$volumes" ]    && docker volume rm -f $volumes >/dev/null
[ -n "$images" ]     && docker image rm -f $images >/dev/null 2>&1 || true

echo "Removed. Rebuild cleanly with: ./scripts/start.sh $MODE clean"
