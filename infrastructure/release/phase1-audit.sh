#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

failures=0
fail(){ printf 'FAIL: %s\n' "$1" >&2; failures=$((failures+1)); }
required_files=(
  docker-compose.prod.yml
  infrastructure/docker/web.Dockerfile
  infrastructure/docker/nginx.Dockerfile
  infrastructure/docker/nginx.conf.template
  supabase/migrations/20260927000000_nextjs_fullstack.sql
  docs/supabase-nextjs-architecture.md
  .github/workflows/ci-cd.yml
)
for file in "${required_files[@]}"; do [[ -f "$file" ]] || fail "missing: $file"; done
[[ ! -d apps/api ]] || fail 'legacy NestJS apps/api directory still exists'
! grep -R -E 'vrompt-api|REDIS_URL|DATABASE_URL' docker-compose*.yml .env*.example >/dev/null 2>&1 ||
  fail 'legacy API/Postgres/Redis runtime configuration remains'
grep -q 'enable row level security' supabase/migrations/20260927000000_nextjs_fullstack.sql ||
  fail 'Supabase migration is missing RLS'
grep -q 'revoke all on function public.reserve_generation' supabase/migrations/20260927000000_nextjs_fullstack.sql ||
  fail 'quota RPC is not explicitly locked down'
if [[ -f .env.production ]] && command -v docker >/dev/null 2>&1; then
  docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet ||
    fail 'production Compose configuration is invalid'
fi
printf 'Automated launch audit: %s failure(s)\n' "$failures"
[[ "$failures" -eq 0 ]]
