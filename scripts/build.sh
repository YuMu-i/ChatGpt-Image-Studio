#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"
BACKEND_DIR="$REPO_ROOT/backend"
DIST_DIR="$REPO_ROOT/dist"

echo "[1/2] Building frontend..."
cd "$WEB_DIR"
npm ci
npm run build

echo "[2/2] Building backend..."
mkdir -p "$DIST_DIR"
cd "$BACKEND_DIR"
go build -o "$DIST_DIR/chatgpt2api-studio" .

echo "Build complete: $DIST_DIR"
