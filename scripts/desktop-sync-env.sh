#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ENV="${1:-$ROOT_DIR/.env}"
APP_DATA_DIR="${PLAYLET_APP_DATA_DIR:-$HOME/Library/Application Support/com.playlet.desktop}"
TARGET_ENV="$APP_DATA_DIR/.env"

log_info() {
  printf '\033[32m[desktop:sync-env]\033[0m %s\n' "$1"
}

log_warn() {
  printf '\033[33m[desktop:sync-env]\033[0m %s\n' "$1"
}

log_error() {
  printf '\033[31m[desktop:sync-env]\033[0m %s\n' "$1" >&2
  exit 1
}

if [[ ! -f "$SOURCE_ENV" ]]; then
  log_error "未找到源 .env：$SOURCE_ENV"
fi

mkdir -p "$APP_DATA_DIR" || log_error "无法创建目录：$APP_DATA_DIR"

if [[ -f "$TARGET_ENV" ]]; then
  BACKUP_PATH="$TARGET_ENV.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$TARGET_ENV" "$BACKUP_PATH"
  log_warn "已备份旧配置：$BACKUP_PATH"
fi

cp "$SOURCE_ENV" "$TARGET_ENV"
chmod 600 "$TARGET_ENV" || true

log_info "已同步：$SOURCE_ENV -> $TARGET_ENV"
log_info "注意：客户端需重启后才会读取新环境变量。"
