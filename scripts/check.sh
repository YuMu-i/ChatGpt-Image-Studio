#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"
BACKEND_DIR="$REPO_ROOT/backend"

echo "[1/4] Running backend tests..."
cd "$BACKEND_DIR"
go test ./...

echo "[2/4] Running frontend type check..."
cd "$WEB_DIR"
npx tsc --noEmit

echo "[3/4] Running frontend lint..."
npm run lint

echo "[4/4] Running frontend production build..."
npm run build

echo "Checks complete."
