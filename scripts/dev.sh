#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"
BACKEND_DIR="$REPO_ROOT/backend"

echo "[1/2] Building frontend static assets..."
cd "$WEB_DIR"
npm ci
npm run build

echo "[2/2] Starting backend on configured port..."
cd "$BACKEND_DIR"
go run .
