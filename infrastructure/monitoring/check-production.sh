#!/usr/bin/env bash
set -Eeuo pipefail
BASE_URL="${VROMPT_PUBLIC_URL:?Set VROMPT_PUBLIC_URL}"
ENV_FILE="${ENV_FILE:-.env.production}"
failures=0
fail(){ printf 'FAIL: %s\n' "$1" >&2; failures=$((failures+1)); }

curl --fail --silent --show-error --max-time 10 "${BASE_URL%/}/health" >/dev/null ||
  fail 'public Next.js/Supabase health endpoint is unavailable'
curl --fail --silent --show-error --max-time 10 "${BASE_URL%/}/api/v1/health" >/dev/null ||
  fail 'same-origin API health endpoint is unavailable'
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml ps |
  grep -Eiq 'unhealthy|exit|dead' && fail 'a production container is unhealthy or stopped' || true

disk_used=$(df -P / | awk 'NR == 2 {gsub(/%/, "", $5); print $5}')
[[ -n "$disk_used" && "$disk_used" -lt 85 ]] || fail "disk usage is ${disk_used:-unknown}%"
if command -v free >/dev/null 2>&1; then
  memory_used=$(free | awk '/Mem:/ {printf "%.0f", ($3 / $2) * 100}')
  [[ "$memory_used" -lt 90 ]] || fail "memory usage is ${memory_used}%"
fi
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml stats --no-stream 2>/dev/null || true
[[ "$failures" -eq 0 ]]
