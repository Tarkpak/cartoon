import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import * as schema from './schema'

// 数据库文件路径
const DB_PATH = './data/manju.db'

// 确保数据目录存在
const dbDir = dirname(DB_PATH)
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true })
}

// 创建 SQLite 连接
const sqlite = new Database(DB_PATH)

// 启用 WAL 模式提高并发性能
sqlite.pragma('journal_mode = WAL')

// 启用外键约束，确保删除项目时级联清理数据
sqlite.pragma('foreign_keys = ON')

// 创建 Drizzle 实例
export const db = drizzle(sqlite, { schema })

// 导出 schema
export * from './schema'

// 初始化数据库表
export function initDatabase() {
  // 创建项目表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      workflow_type TEXT NOT NULL DEFAULT 'asset_consistency',
      style_id TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      status TEXT DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  // 兼容旧数据库：补充项目工作流字段
  const projectColumns = sqlite.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>
  const hasProjectColumn = (name: string) => projectColumns.some(c => c.name === name)
  if (!hasProjectColumn('workflow_type')) sqlite.exec('ALTER TABLE projects ADD COLUMN workflow_type TEXT NOT NULL DEFAULT \'asset_consistency\'')
  sqlite.exec('UPDATE projects SET workflow_type = \'asset_consistency\' WHERE workflow_type IS NULL OR workflow_type != \'asset_consistency\'')

  // 创建剧本表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT,
      raw_text TEXT NOT NULL,
      parsed_data TEXT,
      total_duration INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  // 创建场景表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      script_id TEXT REFERENCES scripts(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      title TEXT,
      description TEXT NOT NULL,
      setting TEXT,
      characters TEXT,
      dialogues TEXT,
      duration INTEGER DEFAULT 8,
      narration TEXT,
      shot_type TEXT,
      camera_movement TEXT,
      camera_note TEXT,
      transition_in TEXT,
      transition_out TEXT,
      transition_duration REAL,
      first_frame TEXT,
      last_frame TEXT,
      video_url TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  // 创建角色表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT,
      appearance TEXT NOT NULL,
      personality TEXT,
      traits TEXT,
      background TEXT,
      motivation TEXT,
      speaking_style TEXT,
      catchphrase TEXT,
      voice_tone TEXT,
      age INTEGER,
      gender TEXT,
      base_image TEXT,
      expressions TEXT,
      views TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  // 兼容旧数据库：补充新增角色字段
  const characterColumns = sqlite.prepare('PRAGMA table_info(characters)').all() as Array<{ name: string }>
  const hasCharacterColumn = (name: string) => characterColumns.some(c => c.name === name)
  if (!hasCharacterColumn('traits')) sqlite.exec('ALTER TABLE characters ADD COLUMN traits TEXT')
  if (!hasCharacterColumn('background')) sqlite.exec('ALTER TABLE characters ADD COLUMN background TEXT')
  if (!hasCharacterColumn('motivation')) sqlite.exec('ALTER TABLE characters ADD COLUMN motivation TEXT')
  if (!hasCharacterColumn('speaking_style')) sqlite.exec('ALTER TABLE characters ADD COLUMN speaking_style TEXT')
  if (!hasCharacterColumn('catchphrase')) sqlite.exec('ALTER TABLE characters ADD COLUMN catchphrase TEXT')
  if (!hasCharacterColumn('voice_tone')) sqlite.exec('ALTER TABLE characters ADD COLUMN voice_tone TEXT')

  // 创建视频任务表 (移除外键约束以支持临时场景ID)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS video_tasks (
      id TEXT PRIMARY KEY,
      scene_id TEXT,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      config TEXT,
      video_data TEXT,
      audio_data TEXT,
      metadata TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  // 创建生成视频表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS generated_videos (
      id TEXT PRIMARY KEY,
      scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES video_tasks(id),
      video_path TEXT,
      audio_path TEXT,
      duration REAL,
      resolution TEXT,
      aspect_ratio TEXT,
      fps INTEGER DEFAULT 24,
      has_audio INTEGER DEFAULT 1,
      file_size INTEGER,
      created_at TEXT NOT NULL
    )
  `)

  // 创建系统配置表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  // 创建模型调试日志表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS model_debug_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      request_json TEXT,
      response_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL
    )
  `)

  // 创建索引
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_scripts_project ON scripts(project_id);
    CREATE INDEX IF NOT EXISTS idx_scenes_script ON scenes(script_id);
    CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);
    CREATE INDEX IF NOT EXISTS idx_video_tasks_scene ON video_tasks(scene_id);
    CREATE INDEX IF NOT EXISTS idx_video_tasks_status ON video_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_generated_videos_scene ON generated_videos(scene_id);
    CREATE INDEX IF NOT EXISTS idx_model_debug_logs_timestamp ON model_debug_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_model_debug_logs_provider ON model_debug_logs(provider);
    CREATE INDEX IF NOT EXISTS idx_model_debug_logs_operation ON model_debug_logs(operation);
    CREATE INDEX IF NOT EXISTS idx_model_debug_logs_status ON model_debug_logs(status);
  `)

  console.log('[DB] 数据库初始化完成')
}

// 导出原始 sqlite 实例供高级操作使用
export { sqlite }
