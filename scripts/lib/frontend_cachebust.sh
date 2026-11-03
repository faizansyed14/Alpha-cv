#!/usr/bin/env bash
# Shared by start.sh and frontend.sh. Source it from the project root.

# Fingerprint frontend source so Docker cannot reuse a stale Next.js build layer
# when only app code changed (frequent on Docker Desktop / Windows).
frontend_cachebust() {
  local root="frontend"
  if ! command -v sha256sum >/dev/null 2>&1; then
    date +%s
    return 0
  fi

  # Only hash paths that exist, `find` exits 1 on missing args, which with
  # `set -o pipefail` would abort start.sh with no useful message.
  local -a paths=()
  [ -d "$root/src" ] && paths+=("$root/src")
  [ -d "$root/public" ] && paths+=("$root/public")
  local f
  for f in \
    "$root/package.json" \
    "$root/package-lock.json" \
    "$root/next.config.ts" \
    "$root/next.config.mjs" \
    "$root/next.config.js" \
    "$root/tsconfig.json" \
    "$root/postcss.config.mjs" \
    "$root/tailwind.config.ts" \
    "$root/tailwind.config.js" \
    "$root/components.json"
  do
    [ -f "$f" ] && paths+=("$f")
  done

  if [ ${#paths[@]} -eq 0 ]; then
    date +%s
    return 0
  fi

  local hash
  hash="$(
    find "${paths[@]}" -type f 2>/dev/null \
      | LC_ALL=C sort \
      | while IFS= read -r file; do sha256sum "$file"; done \
      | sha256sum \
      | awk '{print $1}'
  )" || true

  if [ -n "${hash:-}" ]; then
    printf '%s\n' "$hash"
  else
    date +%s
  fi
}
