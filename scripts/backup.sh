#!/usr/bin/env bash
###############################################################################
# AlphaCV, backup
#
# Usage: ./scripts/backup.sh local|dev|prod [--out DIR] [--keep N] [--include-env] [--skip postgres,qdrant,files]
#
# Makes one dated folder  DIR/<stack>/<UTC time>/  (default DIR = ./backups) holding:
#   postgres.dump     the whole database (pg_dump custom format): users, candidates, job descriptions, postings, applications
#   qdrant/*.snapshot the vector store, one snapshot per collection (taken while the app runs)
#   files.tar.gz      local stack only: the raw CV / JD files in the uploads volume
#   files-s3.txt      dev / prod: where the raw files are (S3); see BACKUP_S3_URI below
#   manifest.txt      what was saved, the schema version and row / point counts (restore.sh checks them again)
#   SHA256SUMS        a checksum for every file above
#
# It only READS from the running stack and writes into the backup folder: nothing in the app, the database or the buckets is changed.
#
# Dev and prod keep their raw files in S3. Turn on bucket versioning there (the safety net for overwritten / deleted files), and, if you want a
# second copy, set BACKUP_S3_URI=s3://another-bucket/alphacv-backups in the environment: the files are then synced there on every backup
# (needs the AWS CLI on this machine, with permission for both buckets). The database on RDS has AWS's own automated snapshots as well;
# this backup is the copy you can restore anywhere.
#
# --keep N     afterwards delete all but the newest N backups of this stack (only folders this script made, in this stack's folder)
# --include-env also copy the stack's env file into the backup (it holds SECRETS: keep the backup folder as private as the env file)
###############################################################################
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/stack.sh
source "$SCRIPT_DIR/lib/stack.sh"

MODE="${1:-}"; [ -n "$MODE" ] || die "usage: $0 local|dev|prod [--out DIR] [--keep N] [--include-env] [--skip postgres,qdrant,files]"
shift || true
OUT_ROOT="$REPO_ROOT/backups"; KEEP=""; INCLUDE_ENV=0; SKIP=","
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT_ROOT="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    --include-env) INCLUDE_ENV=1; shift ;;
    --skip) SKIP=",$2,"; shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done
skipped() { [[ "$SKIP" == *",$1,"* ]]; }

load_stack "$MODE"
docker info >/dev/null 2>&1 || die "Docker is not running (or you may not use it)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="$OUT_ROOT/$MODE/$STAMP"
mkdir -p "$DIR/qdrant"
chmod 700 "$OUT_ROOT" "$OUT_ROOT/$MODE" "$DIR" 2>/dev/null || true
FAILED=1
trap 'if [ "$FAILED" = 1 ]; then echo "Backup FAILED: the unfinished folder is kept as $DIR.failed" >&2; mv "$DIR" "$DIR.failed" 2>/dev/null || true; fi' EXIT

say "Backing up the $MODE stack into $DIR"
MANIFEST="$DIR/manifest.txt"
{
  echo "stack=$MODE"
  echo "created_utc=$STAMP"
  echo "compose_file=$COMPOSE_FILE"
  echo "git_commit=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
} > "$MANIFEST"

# ------------------------------------------------------------------------------------------------------------------ Postgres
if ! skipped postgres; then
  say "Postgres: dumping the database ($PG_KIND)"
  pg_dump_to "$DIR/postgres.dump"
  [ -s "$DIR/postgres.dump" ] || die "the database dump is empty"
  pg_list "$DIR/postgres.dump" >/dev/null || die "the database dump cannot be read back"
  REV="$(pg_query "SELECT version_num FROM alembic_version" | head -1 || true)"
  echo "schema_revision=${REV:-unknown}" >> "$MANIFEST"
  for t in '"user"' candidate job_description job_posting job_application candidate_note saved_candidate bug_report; do
    n="$(pg_query "SELECT count(*) FROM $t" | head -1 || true)"
    [ -n "$n" ] && echo "rows.${t//\"/}=$n" >> "$MANIFEST"
  done
  say "Postgres: $(du -h "$DIR/postgres.dump" | cut -f1), schema ${REV:-unknown}"
fi

# ------------------------------------------------------------------------------------------------------------------ Qdrant
if ! skipped qdrant; then
  say "Qdrant: taking snapshots"
  LIST="$(qdrant_tool list | tr -d '\r')"
  [ -n "$LIST" ] || say "Qdrant: no collections yet (nothing to save)"
  while read -r name count; do
    [ -n "${name:-}" ] || continue
    qdrant_tool export "$name" </dev/null > "$DIR/qdrant/$name.snapshot"      # </dev/null: docker would otherwise eat the rest of the list
    [ -s "$DIR/qdrant/$name.snapshot" ] || die "the snapshot of $name is empty"
    echo "points.$name=$count" >> "$MANIFEST"
    say "Qdrant: $name ($count points, $(du -h "$DIR/qdrant/$name.snapshot" | cut -f1))"
  done <<< "$LIST"
fi

# ------------------------------------------------------------------------------------------------------------------ raw files
if ! skipped files; then
  if [ "$FILES_KIND" = volume ]; then
    VOLUME="$(project_name)_uploads-local-data"
    docker volume inspect "$VOLUME" >/dev/null 2>&1 || die "volume $VOLUME not found"
    say "Files: copying the uploads volume ($VOLUME)"
    docker run --rm -v "$VOLUME:/data:ro" alpine tar czf - -C /data . > "$DIR/files.tar.gz"
    [ -s "$DIR/files.tar.gz" ] || die "the files archive is empty"
    echo "files=files.tar.gz" >> "$MANIFEST"
  else
    BUCKET="$(env_get S3_BUCKET)"; PREFIX="$(env_get S3_PREFIX)"
    SRC="s3://$BUCKET/${PREFIX:+$PREFIX/}"
    echo "files_source=$SRC" > "$DIR/files-s3.txt"
    if command -v aws >/dev/null 2>&1; then
      VERSIONING="$(aws s3api get-bucket-versioning --bucket "$BUCKET" --query Status --output text 2>/dev/null || echo unknown)"
      echo "bucket_versioning=$VERSIONING" >> "$DIR/files-s3.txt"
      [ "$VERSIONING" = Enabled ] || say "WARNING: versioning is not enabled on $BUCKET: an overwritten or deleted CV file could not be brought back"
      if [ -n "${BACKUP_S3_URI:-}" ]; then
        DEST="${BACKUP_S3_URI%/}/$MODE/$STAMP/"
        say "Files: syncing $SRC to $DEST"
        aws s3 sync "$SRC" "$DEST" --only-show-errors
        echo "files_backup_uri=$DEST" >> "$DIR/files-s3.txt"; echo "files_backup_uri=$DEST" >> "$MANIFEST"
      fi
    else
      say "Files: the AWS CLI is not installed here, so the S3 files were not copied or checked (they stay where they are: $SRC)"
    fi
    echo "files_source=$SRC" >> "$MANIFEST"
  fi
fi

# ------------------------------------------------------------------------------------------------------------------ env, checksums
if [ "$INCLUDE_ENV" = 1 ]; then
  cp "$ENV_FILE" "$DIR/env.secret"; chmod 600 "$DIR/env.secret"
  say "WARNING: $DIR/env.secret holds this stack's secrets"
fi
( cd "$DIR" && find . -type f ! -name SHA256SUMS | sort | while read -r f; do sha256_of "$f"; done > SHA256SUMS )
chmod -R go-rwx "$DIR" 2>/dev/null || true
FAILED=0
say "Done: $DIR ($(du -sh "$DIR" | cut -f1))"

# ------------------------------------------------------------------------------------------------------------------ retention
if [ -n "$KEEP" ]; then
  [[ "$KEEP" =~ ^[0-9]+$ ]] && [ "$KEEP" -ge 1 ] || die "--keep needs a number of 1 or more"
  ls -1 "$OUT_ROOT/$MODE" | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort -r | tail -n +"$((KEEP + 1))" | while read -r d; do
    say "Retention: removing the old backup $d"
    rm -rf "${OUT_ROOT:?}/$MODE/$d"
  done
fi
