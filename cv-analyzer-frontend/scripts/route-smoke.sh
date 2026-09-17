#!/usr/bin/env bash
# Runtime smoke: start the built Next server (proxying /api to the demo backend)
# and curl each route, asserting HTTP 200 and no Next.js error overlay marker.
# Prereqs: `npm run build` done; demo backend running on :8000
#   (cd alpha-backend && PYTHONPATH=. python3 tests/run_demo_server.py)
set -Euo pipefail
cd "$(dirname "$0")/.."

export BACKEND_INTERNAL_URL="http://localhost:8000"
export PORT=3100
PUBLIC_TOKEN="${1:-}"

npx next start -p "$PORT" >/tmp/next-start.log 2>&1 &
NEXT_PID=$!
trap 'kill $NEXT_PID 2>/dev/null || true' EXIT

# wait for server
for i in $(seq 1 40); do
  curl -sf "http://localhost:$PORT/login" >/dev/null 2>&1 && break
  sleep 1
done

routes=("/login" "/" "/careers" "/careers/openings" "/tracker" "/admin/users")
[ -n "$PUBLIC_TOKEN" ] && routes+=("/careers/jobs/$PUBLIC_TOKEN")

fail=0
for r in "${routes[@]}"; do
  code=$(curl -s -o /tmp/page.html -w "%{http_code}" "http://localhost:$PORT$r" || echo 000)
  if [ "$code" != "200" ]; then
    echo "[FAIL] $r -> HTTP $code"; fail=1; continue
  fi
  if grep -qi "Application error\|Internal Server Error\|__next_error__" /tmp/page.html; then
    echo "[FAIL] $r -> error markup in response"; fail=1; continue
  fi
  echo "[PASS] $r -> 200"
done
exit $fail
