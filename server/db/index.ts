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

// 禁用外键约束检查 (允许临时场景ID)
sqlite.pragma('foreign_keys = OFF')

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
      status TEXT DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

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
      first_frame TEXT,
      last_frame TEXT,
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
      age INTEGER,
      gender TEXT,
      base_image TEXT,
      expressions TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

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

  // 创建索引
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_scripts_project ON scripts(project_id);
    CREATE INDEX IF NOT EXISTS idx_scenes_script ON scenes(script_id);
    CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);
    CREATE INDEX IF NOT EXISTS idx_video_tasks_scene ON video_tasks(scene_id);
    CREATE INDEX IF NOT EXISTS idx_video_tasks_status ON video_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_generated_videos_scene ON generated_videos(scene_id);
  `)

  console.log('[DB] 数据库初始化完成')
}

// 导出原始 sqlite 实例供高级操作使用
export { sqlite }
