#!/usr/bin/env bash
set -Eeuo pipefail
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${VROMPT_IMAGE_PREFIX:?VROMPT_IMAGE_PREFIX is required}"
export VROMPT_WEB_IMAGE="${VROMPT_IMAGE_PREFIX}/web:${IMAGE_TAG}"
export VROMPT_NGINX_IMAGE="${VROMPT_IMAGE_PREFIX}/nginx:${IMAGE_TAG}"

docker compose --env-file .env.production \
  -f docker-compose.prod.yml \
  -f docker-compose.deploy.yml \
  up -d --no-build --remove-orphans vrompt-nginx vrompt-web

VROMPT_PUBLIC_URL="${VROMPT_PUBLIC_URL:-https://${VROMPT_DOMAIN}}" infrastructure/deploy/health-check.sh
echo "Vrompt rollback ${IMAGE_TAG} is healthy."
