import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { manualProviderSeedAvailableModels } from './model-provider-models'

let db: Database | null = null

export interface AppSettings {
  maxDevicesPerUser: number
  restrictConcurrentDevices: boolean
  maxConcurrentDevices: number
  disabledGraceSeconds: number
  logArchiveMaxRows: number
}

export function nowIso(date = new Date()) {
  return date.toISOString()
}

export function dataDir() {
  return resolve(process.cwd(), process.env.PLAYLET_ADMIN_DATA_DIR || './data')
}

export function databasePath() {
  return resolve(dataDir(), 'playlet-admin.db')
}

export function getDb() {
  if (db) return db

  const target = databasePath()
  const dir = dirname(target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  db = new Database(target)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  initSchema(db)
  return db
}

function initSchema(conn: Database) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      account TEXT NOT NULL UNIQUE,
      email TEXT,
      phone TEXT,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      device_id TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      device_name TEXT,
      os TEXT,
      client_version TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, device_id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,
      provider_key TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      base_url TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_credentials (
      provider_id TEXT PRIMARY KEY REFERENCES model_providers(id) ON DELETE CASCADE,
      encrypted_api_key TEXT,
      encrypted_access_key TEXT,
      encrypted_secret_key TEXT,
      encrypted_security_token TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_openai_providers (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      encrypted_api_key TEXT NOT NULL DEFAULT '',
      models_json TEXT NOT NULL DEFAULT '[]',
      available_models_json TEXT NOT NULL DEFAULT '[]',
      synced_at TEXT,
      sync_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_provider_models (
      provider_id TEXT PRIMARY KEY REFERENCES model_providers(id) ON DELETE CASCADE,
      models_json TEXT NOT NULL DEFAULT '[]',
      available_models_json TEXT NOT NULL DEFAULT '[]',
      synced_at TEXT,
      sync_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tos_storage_config (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      access_key_id TEXT NOT NULL DEFAULT '',
      encrypted_secret_key TEXT NOT NULL DEFAULT '',
      encrypted_security_token TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      endpoint TEXT NOT NULL DEFAULT '',
      bucket TEXT NOT NULL DEFAULT '',
      key_prefix TEXT NOT NULL DEFAULT '',
      public_base_url TEXT NOT NULL DEFAULT '',
      is_custom_domain INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS client_versions (
      id TEXT PRIMARY KEY,
      app_key TEXT NOT NULL DEFAULT 'cartoon-desktop',
      platform TEXT NOT NULL,
      arch TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'stable',
      version TEXT NOT NULL,
      build_number INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      download_url TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',
      signature TEXT NOT NULL DEFAULT '',
      release_notes TEXT NOT NULL DEFAULT '',
      force_update INTEGER NOT NULL DEFAULT 0,
      min_supported_version TEXT NOT NULL DEFAULT '',
      rollout_percent INTEGER NOT NULL DEFAULT 100,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      local_project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      script_parse_mode TEXT,
      style_id TEXT,
      aspect_ratio TEXT,
      status TEXT,
      summary_json TEXT,
      local_created_at TEXT,
      local_updated_at TEXT,
      last_synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, local_project_id)
    );

    CREATE TABLE IF NOT EXISTS user_project_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES user_projects(id) ON DELETE CASCADE,
      snapshot_json TEXT NOT NULL,
      snapshot_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_prompt_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      local_profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, local_profile_id)
    );

    CREATE TABLE IF NOT EXISTS user_prompt_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      profile_id TEXT REFERENCES user_prompt_profiles(id) ON DELETE SET NULL,
      local_template_id TEXT,
      template_key TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, profile_id, template_key)
    );

    CREATE TABLE IF NOT EXISTS user_prompt_versions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_id TEXT REFERENCES user_prompt_templates(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      change_summary TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_prompt_state (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_prompt_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_model_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workflow_step TEXT NOT NULL,
      model_id TEXT NOT NULL,
      model_options_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, workflow_step)
    );

    CREATE TABLE IF NOT EXISTS model_call_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      request_id TEXT,
      provider TEXT,
      model_id TEXT,
      operation TEXT,
      project_id TEXT,
      scene_id TEXT,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      estimated_cost REAL,
      error_message TEXT,
      request_json TEXT,
      response_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata_json TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS log_archives (
      id TEXT PRIMARY KEY,
      archive_type TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_devices_user_id ON user_devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON user_projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_project_snapshots_project_id ON user_project_snapshots(project_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_templates_user_id ON user_prompt_templates(user_id);
    CREATE INDEX IF NOT EXISTS idx_model_preferences_user_id ON user_model_preferences(user_id);
    CREATE INDEX IF NOT EXISTS idx_model_call_logs_created_at ON model_call_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_client_versions_lookup ON client_versions(app_key, platform, arch, channel, status);
    CREATE INDEX IF NOT EXISTS idx_client_versions_version ON client_versions(version);
  `)

  ensureDefaultSettings(conn)
  ensureDefaultProviders(conn)
  ensureDefaultProviderModels(conn)
  ensureDefaultTosStorageConfig(conn)
}

function ensureDefaultSettings(conn: Database) {
  const defaults: Record<string, string> = {
    max_devices_per_user: '3',
    restrict_concurrent_devices: 'false',
    max_concurrent_devices: '1',
    disabled_grace_seconds: '60',
    log_archive_max_rows: '50000'
  }

  const insert = conn.prepare(`
    INSERT OR IGNORE INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
  `)
  const timestamp = nowIso()
  for (const [key, value] of Object.entries(defaults)) {
    insert.run(key, value, timestamp)
  }
}

function ensureDefaultProviders(conn: Database) {
  const providers = [
    ['gemini', 'Gemini', 'https://generativelanguage.googleapis.com/v1beta'],
    ['qwen', '通义千问', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    ['volcengine', '火山方舟', 'https://ark.cn-beijing.volces.com/api/v3'],
    ['deepseek', 'DeepSeek', 'https://api.deepseek.com'],
    ['kling', '可灵', 'https://api-beijing.klingai.com'],
    ['custom_openai', '自定义 OpenAI 兼容', '']
  ]

  const insertProvider = conn.prepare(`
    INSERT OR IGNORE INTO model_providers
      (id, provider_key, display_name, base_url, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `)
  const insertCreds = conn.prepare(`
    INSERT OR IGNORE INTO provider_credentials
      (provider_id, encrypted_api_key, encrypted_access_key, encrypted_secret_key, encrypted_security_token, updated_at)
    VALUES (?, '', '', '', '', ?)
  `)
  const timestamp = nowIso()
  for (const [providerKey, displayName, baseUrl] of providers) {
    const id = `provider_${providerKey}`
    insertProvider.run(id, providerKey, displayName, baseUrl, timestamp, timestamp)
    insertCreds.run(id, timestamp)
  }

  conn.prepare(`
    UPDATE model_providers
    SET base_url = ?, updated_at = ?
    WHERE provider_key = 'qwen' AND base_url = ?
  `).run(
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    timestamp,
    'https://dashscope.aliyuncs.com/api/v1'
  )
}

function ensureDefaultProviderModels(conn: Database) {
  const timestamp = nowIso()
  const providers = conn
    .prepare('SELECT id, provider_key FROM model_providers')
    .all() as Array<{ id: string, provider_key: string }>
  const resetMigrationDone = Boolean(conn
    .prepare("SELECT value FROM app_settings WHERE key = 'model_provider_default_selection_reset_v1' LIMIT 1")
    .get())
  const insertModels = conn.prepare(`
    INSERT OR IGNORE INTO model_provider_models
      (provider_id, models_json, available_models_json, synced_at, sync_error, updated_at)
    VALUES (?, ?, ?, NULL, NULL, ?)
  `)
  const resetDefaultSelectedModels = conn.prepare(`
    UPDATE model_provider_models
    SET models_json = '[]', updated_at = ?
    WHERE provider_id = ?
      AND models_json = ?
      AND available_models_json = ?
      AND synced_at IS NULL
      AND sync_error IS NULL
  `)

  for (const provider of providers) {
    const models = manualProviderSeedAvailableModels(provider.provider_key)
    const modelsJson = JSON.stringify(models)
    insertModels.run(provider.id, '[]', modelsJson, timestamp)
    if (!resetMigrationDone) {
      resetDefaultSelectedModels.run(timestamp, provider.id, modelsJson, modelsJson)
    }
  }

  if (!resetMigrationDone) {
    conn.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('model_provider_default_selection_reset_v1', 'true', ?)
    `).run(timestamp)
  }
}

function ensureDefaultTosStorageConfig(conn: Database) {
  const timestamp = nowIso()
  conn.prepare(`
    INSERT OR IGNORE INTO tos_storage_config
      (id, enabled, access_key_id, encrypted_secret_key, encrypted_security_token, region, endpoint, bucket, key_prefix, public_base_url, is_custom_domain, created_at, updated_at)
    VALUES ('default', 0, '', '', '', '', '', '', '', '', 0, ?, ?)
  `).run(timestamp, timestamp)
}

export function getSetting(key: string, fallback = '') {
  const row = getDb()
    .prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1')
    .get(key) as { value: string } | undefined
  return row?.value ?? fallback
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    .run(key, value, nowIso())
}

export function getAppSettings(): AppSettings {
  return {
    maxDevicesPerUser: Number.parseInt(getSetting('max_devices_per_user', '3'), 10) || 3,
    restrictConcurrentDevices: getSetting('restrict_concurrent_devices', 'false') === 'true',
    maxConcurrentDevices: Number.parseInt(getSetting('max_concurrent_devices', '1'), 10) || 1,
    disabledGraceSeconds: Number.parseInt(getSetting('disabled_grace_seconds', '60'), 10) || 60,
    logArchiveMaxRows: Number.parseInt(getSetting('log_archive_max_rows', '50000'), 10) || 50000
  }
}

export function parseJsonText<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function jsonText(value: unknown) {
  return JSON.stringify(value ?? null)
}
