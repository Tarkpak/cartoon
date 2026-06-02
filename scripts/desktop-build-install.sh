#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Playlet Desktop.app"
BUNDLE_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME"

REQUESTED_INSTALL_DIR="${PLAYLET_INSTALL_DIR:-/Applications}"
INSTALL_DIR="$REQUESTED_INSTALL_DIR"

log_info() {
  printf '\033[32m[desktop:install]\033[0m %s\n' "$1"
}

log_warn() {
  printf '\033[33m[desktop:install]\033[0m %s\n' "$1"
}

log_error() {
  printf '\033[31m[desktop:install]\033[0m %s\n' "$1" >&2
  exit 1
}

if [[ "${PLAYLET_SYNC_ENV:-1}" == "1" ]]; then
  if [[ -f "$ROOT_DIR/.env" ]]; then
    bash "$ROOT_DIR/scripts/desktop-sync-env.sh" "$ROOT_DIR/.env"
  else
    log_warn "未找到项目 .env，跳过环境变量同步。"
  fi
fi

if [[ "$REQUESTED_INSTALL_DIR" == "/Applications" && ! -w "/Applications" ]]; then
  INSTALL_DIR="$HOME/Applications"
  log_warn "当前用户对 /Applications 无写权限，自动改为安装到 $INSTALL_DIR"
fi

log_info "开始构建桌面客户端（app bundle）..."
(
  cd "$ROOT_DIR"
  CI=true bunx tauri build --bundles app
)

if [[ ! -d "$BUNDLE_PATH" ]]; then
  log_error "构建成功但未找到应用包：$BUNDLE_PATH"
fi

mkdir -p "$INSTALL_DIR" || log_error "无法创建安装目录：$INSTALL_DIR"
if [[ ! -w "$INSTALL_DIR" ]]; then
  log_error "安装目录无写权限：$INSTALL_DIR（可设置 PLAYLET_INSTALL_DIR 指定其它目录）"
fi

TARGET_APP_PATH="$INSTALL_DIR/$APP_NAME"

log_info "尝试关闭正在运行的客户端..."
osascript -e 'tell application "Playlet Desktop" to quit' >/dev/null 2>&1 || true
sleep 1

log_info "安装到：$TARGET_APP_PATH"
rm -rf "$TARGET_APP_PATH"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$BUNDLE_PATH/" "$TARGET_APP_PATH/"
else
  cp -R "$BUNDLE_PATH" "$TARGET_APP_PATH"
fi

# 清理隔离属性，避免首次打开被系统拦截
xattr -dr com.apple.quarantine "$TARGET_APP_PATH" >/dev/null 2>&1 || true

log_info "启动客户端..."
open "$TARGET_APP_PATH" >/dev/null 2>&1 || true

log_info "完成。"
printf 'Installed: %s\n' "$TARGET_APP_PATH"
