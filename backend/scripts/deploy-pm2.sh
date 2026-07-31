#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${PM2_APP_NAME:-playlet-admin-backend}"
HOST="${HOST:-127.0.0.1}"
APP_PORT="${PLAYLET_ADMIN_PORT:-43200}"
DATA_DIR="${PLAYLET_ADMIN_DATA_DIR:-$ROOT_DIR/data}"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

if ! command_exists bun; then
  echo "bun is required but was not found in PATH." >&2
  exit 1
fi

if ! command_exists pm2; then
  echo "pm2 is required but was not found in PATH. Install it with: npm i -g pm2" >&2
  exit 1
fi

mkdir -p "$DATA_DIR" "$ROOT_DIR/logs"

cd "$ROOT_DIR"

echo "Installing backend dependencies..."
bun install --frozen-lockfile

echo "Building backend..."
bun run build

echo "Starting or reloading PM2 app: $APP_NAME"
export PM2_APP_NAME="$APP_NAME"
export HOST
export PLAYLET_ADMIN_PORT="$APP_PORT"
export PORT="$APP_PORT"
export NITRO_HOST="$HOST"
export NITRO_PORT="$APP_PORT"
export PLAYLET_ADMIN_DATA_DIR="$DATA_DIR"

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload pm2.config.cjs --only "$APP_NAME" --update-env
else
  pm2 start pm2.config.cjs --only "$APP_NAME"
fi

pm2 save
pm2 status "$APP_NAME"

echo "Backend is managed by PM2 at http://$HOST:$APP_PORT"
