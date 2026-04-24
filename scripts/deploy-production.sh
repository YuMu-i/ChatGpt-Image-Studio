#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-production}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:7000/image}"

cd "$APP_DIR"

echo "[deploy] app dir: $APP_DIR"
echo "[deploy] target branch: $DEPLOY_BRANCH"

git fetch origin

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "$DEPLOY_BRANCH" ]; then
  git checkout "$DEPLOY_BRANCH"
fi

git pull --ff-only origin "$DEPLOY_BRANCH"

docker compose up -d --build

if [ -n "$HEALTHCHECK_URL" ]; then
  echo "[deploy] healthcheck: $HEALTHCHECK_URL"
  for _ in $(seq 1 30); do
    if curl -fsS "$HEALTHCHECK_URL" >/dev/null; then
      echo "[deploy] healthcheck passed"
      exit 0
    fi
    sleep 5
  done

  echo "[deploy] healthcheck failed" >&2
  exit 1
fi

echo "[deploy] finished without healthcheck"
