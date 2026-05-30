#!/usr/bin/env bash
set -euo pipefail

SOURCE_DB="${1:-$(pwd)/data/playlet.db}"
DESKTOP_ROOT="${2:-$HOME/Library/Application Support/com.playlet.desktop}"
TARGET_DB="$DESKTOP_ROOT/data/playlet.db"

if [[ ! -f "$SOURCE_DB" ]]; then
  echo "Source DB not found: $SOURCE_DB" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DB")"

timestamp="$(date +%Y%m%d-%H%M%S)"
if [[ -f "$TARGET_DB" ]]; then
  backup_path="$TARGET_DB.bak.$timestamp"
  cp "$TARGET_DB" "$backup_path"
  if [[ -f "$TARGET_DB-wal" ]]; then
    cp "$TARGET_DB-wal" "$backup_path-wal"
  fi
  if [[ -f "$TARGET_DB-shm" ]]; then
    cp "$TARGET_DB-shm" "$backup_path-shm"
  fi
  echo "Backed up target DB to: $backup_path"
fi

tmp_db="$TARGET_DB.migrating.$timestamp"
rm -f "$tmp_db"
sqlite3 "$SOURCE_DB" ".backup '$tmp_db'"
mv "$tmp_db" "$TARGET_DB"

copy_dir() {
  local src="$1"
  local dst="$2"
  if [[ ! -d "$src" ]]; then
    return 0
  fi
  mkdir -p "$dst"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$src"/ "$dst"/
  else
    rm -rf "$dst"
    mkdir -p "$(dirname "$dst")"
    cp -R "$src" "$dst"
  fi
}

copy_dir "$(pwd)/public/generated-images" "$DESKTOP_ROOT/public/generated-images"
copy_dir "$(pwd)/public/videos" "$DESKTOP_ROOT/public/videos"
copy_dir "$(pwd)/data/generated-images" "$DESKTOP_ROOT/data/generated-images"
copy_dir "$(pwd)/data/tmp/voice-assets" "$DESKTOP_ROOT/data/tmp/voice-assets"

echo "Migrated DB: $SOURCE_DB -> $TARGET_DB"
echo "Post-migration row counts:"
sqlite3 "$TARGET_DB" "SELECT 'projects', count(*) FROM projects UNION ALL SELECT 'scripts', count(*) FROM scripts UNION ALL SELECT 'scenes', count(*) FROM scenes UNION ALL SELECT 'characters', count(*) FROM characters UNION ALL SELECT 'model_debug_logs', count(*) FROM model_debug_logs UNION ALL SELECT 'system_config', count(*) FROM system_config;"
