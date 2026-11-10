#!/usr/bin/env bash
###############################################################################
# AlphaCV, recovery
#
# Usage: ./scripts/restore.sh local|dev|prod BACKUP_DIR [--check] [--yes] [--only postgres,qdrant,files] [--no-safety-backup]
#
# BACKUP_DIR is a folder made by scripts/backup.sh. This REPLACES the data of the stack with what the backup holds:
#   1. checks the backup (every checksum, the database dump is readable); --check stops here and changes nothing
#   2. asks you to type  RESTORE <stack>  (--yes skips the question)
#   3. saves the CURRENT database first (pre-restore dump next to the backups), unless --no-safety-backup
#   4. stops the app (frontend, API, workers) so nothing writes while data is replaced
#   5. database: pg_restore --clean (one transaction: if it fails, nothing is half-restored)
#      vector store: each snapshot replaces its collection
#      raw files: local stack, extracted into the uploads volume (files already there that the backup does not have are left alone);
#                 dev / prod, copied back from the S3 backup copy when the backup was made with BACKUP_S3_URI
#                 (otherwise the files are still in their bucket; use the bucket's versions to bring an older file back)
#   6. starts the app again (it brings the database schema up to date by itself) and compares row / point counts with the manifest
#
# A backup older than the code is fine (the app migrates it forward when it starts). A backup NEWER than the code is not: update first.
###############################################################################
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/stack.sh
source "$SCRIPT_DIR/lib/stack.sh"

MODE="${1:-}"; BACKUP="${2:-}"
[ -n "$MODE" ] && [ -n "$BACKUP" ] || die "usage: $0 local|dev|prod BACKUP_DIR [--check] [--yes] [--only postgres,qdrant,files] [--no-safety-backup]"
shift 2 || true
CHECK=0; YES=0; ONLY=","; SAFETY=1
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    --yes) YES=1; shift ;;
    --only) ONLY=",$2,"; shift 2 ;;
    --no-safety-backup) SAFETY=0; shift ;;
    *) die "unknown option: $1" ;;
  esac
done
wanted() { [ "$ONLY" = "," ] || [[ "$ONLY" == *",$1,"* ]]; }

load_stack "$MODE"
docker info >/dev/null 2>&1 || die "Docker is not running (or you may not use it)"
BACKUP="$(cd "$BACKUP" 2>/dev/null && pwd)" || die "backup folder not found"
[ -f "$BACKUP/manifest.txt" ] || die "$BACKUP has no manifest.txt: it is not a backup made by backup.sh"
manifest() { grep -E "^$1=" "$BACKUP/manifest.txt" | head -1 | cut -d= -f2-; }

[ "$(manifest stack)" = "$MODE" ] || die "this backup is from the '$(manifest stack)' stack, not '$MODE'. (Restoring one stack's data into another is a deliberate act: use the data tools by hand.)"

# ------------------------------------------------------------------------------------------------------------------ 1. check
say "Backup $(manifest created_utc) of the $MODE stack (code $(manifest git_commit), schema $(manifest schema_revision))"
if [ -f "$BACKUP/SHA256SUMS" ]; then
  ( cd "$BACKUP" && if command -v sha256sum >/dev/null 2>&1; then sha256sum -c SHA256SUMS --quiet; else shasum -a 256 -c SHA256SUMS --quiet; fi ) \
    || die "a file in the backup does not match its checksum: the backup is damaged"
  say "Checksums: all files match"
else
  die "SHA256SUMS is missing: the backup cannot be verified"
fi
if wanted postgres && [ -f "$BACKUP/postgres.dump" ]; then
  pg_list "$BACKUP/postgres.dump" >/dev/null || die "postgres.dump cannot be read"
  say "Database dump: readable"
fi
if [ "$CHECK" = 1 ]; then
  say "Check finished: the backup is complete and readable. Nothing was changed."
  exit 0
fi

# ------------------------------------------------------------------------------------------------------------------ 2. confirm
if [ "$YES" != 1 ]; then
  echo
  echo "This REPLACES the data of the $MODE stack ($COMPOSE_FILE) with the backup from $(manifest created_utc)."
  [ "$MODE" = prod ] && echo "THIS IS PRODUCTION."
  read -r -p "Type  RESTORE $MODE  to continue: " ANSWER
  [ "$ANSWER" = "RESTORE $MODE" ] || die "not confirmed, nothing was changed"
fi

# ------------------------------------------------------------------------------------------------------------------ 3. safety copy
if wanted postgres && [ "$SAFETY" = 1 ] && [ -f "$BACKUP/postgres.dump" ]; then
  SAFE_DIR="$(dirname "$BACKUP")/pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$SAFE_DIR"; chmod 700 "$SAFE_DIR" 2>/dev/null || true
  say "Safety copy of the CURRENT database: $SAFE_DIR/postgres.dump"
  pg_dump_to "$SAFE_DIR/postgres.dump"
  [ -s "$SAFE_DIR/postgres.dump" ] || die "the safety copy is empty: nothing was changed"
fi

# ------------------------------------------------------------------------------------------------------------------ 4. stop the app
RUNNING="$("${COMPOSE[@]}" config --services 2>/dev/null | tr -d '\r')"
TO_STOP=""
for s in $APP_SVCS; do grep -qx "$s" <<< "$RUNNING" && TO_STOP="$TO_STOP $s"; done
if [ -n "$TO_STOP" ]; then
  say "Stopping the app:$TO_STOP"
  # shellcheck disable=SC2086
  "${COMPOSE[@]}" stop $TO_STOP >/dev/null
fi
restart() {
  if [ -n "$TO_STOP" ]; then
    say "Starting the app again"
    # shellcheck disable=SC2086
    "${COMPOSE[@]}" start $TO_STOP >/dev/null || true
  fi
}
trap 'restart' EXIT

# ------------------------------------------------------------------------------------------------------------------ 5. restore
if wanted postgres && [ -f "$BACKUP/postgres.dump" ]; then
  say "Database: restoring (one transaction)"
  pg_restore_from "$BACKUP/postgres.dump"
  say "Database: restored"
fi

if wanted qdrant && ls "$BACKUP"/qdrant/*.snapshot >/dev/null 2>&1; then
  for f in "$BACKUP"/qdrant/*.snapshot; do
    name="$(basename "$f" .snapshot)"
    say "Qdrant: recovering $name"
    qdrant_tool import "$name" < "$f"
  done
fi

if wanted files; then
  if [ -f "$BACKUP/files.tar.gz" ]; then
    VOLUME="$(project_name)_uploads-local-data"
    docker volume inspect "$VOLUME" >/dev/null 2>&1 || docker volume create "$VOLUME" >/dev/null
    say "Files: extracting into the uploads volume ($VOLUME)"
    docker run --rm -i -v "$VOLUME:/data" alpine tar xzf - -C /data < "$BACKUP/files.tar.gz"
  elif [ -n "$(manifest files_backup_uri)" ] && command -v aws >/dev/null 2>&1; then
    SRC="$(manifest files_source)"
    say "Files: copying $(manifest files_backup_uri) back to $SRC"
    aws s3 sync "$(manifest files_backup_uri)" "$SRC" --only-show-errors
  elif [ "$FILES_KIND" = s3 ]; then
    say "Files: this backup has no copy of the S3 files; they are still in $(manifest files_source). Use the bucket's object versions to bring older files back."
  fi
fi

# ------------------------------------------------------------------------------------------------------------------ 6. verify
restart; TO_STOP=""
trap - EXIT
BAD=0
if wanted postgres && [ -f "$BACKUP/postgres.dump" ]; then
  for t in candidate job_description job_posting job_application; do
    want="$(manifest "rows.$t")"; [ -n "$want" ] || continue
    got="$(pg_query "SELECT count(*) FROM $t" | head -1 || true)"
    if [ "$got" = "$want" ]; then say "Check: $t = $got"; else say "MISMATCH: $t is $got, the backup had $want"; BAD=1; fi
  done
fi
if wanted qdrant; then
  for f in "$BACKUP"/qdrant/*.snapshot; do
    [ -e "$f" ] || continue
    name="$(basename "$f" .snapshot)"; want="$(manifest "points.$name")"
    got="$(qdrant_tool count "$name" | tr -d '\r' | tail -1 || true)"
    if [ "$got" = "$want" ]; then say "Check: Qdrant $name = $got points"; else say "MISMATCH: Qdrant $name has $got points, the backup had $want"; BAD=1; fi
  done
fi
if [ "$BAD" = 0 ]; then say "Recovery finished: the counts match the backup."; else say "Recovery finished with MISMATCHES above: do not hand the system to users until they are explained."; exit 1; fi
