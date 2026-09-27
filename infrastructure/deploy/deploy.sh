#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "${ROOT_DIR}"

: "${VROMPT_DEPLOY_BRANCH:=production}"
: "${VROMPT_EXPECTED_REPO:=}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${VROMPT_IMAGE_PREFIX:?VROMPT_IMAGE_PREFIX is required}"

if [[ ! -d .git || ! -f docker-compose.prod.yml || ! -d apps/web || -d apps/api ]]; then
  echo 'This directory is not a refactored Vrompt checkout.' >&2
  exit 1
fi
if [[ "$(git branch --show-current)" != "${VROMPT_DEPLOY_BRANCH}" ]]; then
  echo "Refusing deployment from the wrong branch." >&2
  exit 1
fi
if [[ -n "${VROMPT_EXPECTED_REPO}" ]]; then
  remote_url=$(git config --get remote.origin.url || true)
  [[ "${remote_url}" == *"${VROMPT_EXPECTED_REPO}"* ]] || { echo 'Unexpected Git remote.' >&2; exit 1; }
fi
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo 'Refusing deployment with working-tree changes.' >&2
  exit 1
fi

git fetch --prune origin "${VROMPT_DEPLOY_BRANCH}"
git merge --ff-only "origin/${VROMPT_DEPLOY_BRANCH}"
[[ -f .env.production ]] || { echo '.env.production is required.' >&2; exit 1; }

COMPOSE=(docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.deploy.yml)
export VROMPT_WEB_IMAGE="${VROMPT_IMAGE_PREFIX}/web:${IMAGE_TAG}"
export VROMPT_NGINX_IMAGE="${VROMPT_IMAGE_PREFIX}/nginx:${IMAGE_TAG}"

"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" pull vrompt-nginx vrompt-web
"${COMPOSE[@]}" up -d --no-build --remove-orphans
VROMPT_PUBLIC_URL="${VROMPT_PUBLIC_URL:-https://${VROMPT_DOMAIN}}" infrastructure/deploy/health-check.sh
echo "Vrompt deployment ${IMAGE_TAG} is healthy."
