import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { isCloudStorageEnabled } from '../server/utils/cloud-storage'
import { normalizeVideoTaskConfigForStorage } from '../server/utils/video-task-config-storage'
import type { GenerateVideoRequest } from '../shared/types/video'

type VideoTaskConfig = GenerateVideoRequest['config']

type TaskRow = {
  id: string
  config: string | null
  updated_at: string | null
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return
  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

async function main() {
  const projectRoot = process.cwd()
  loadEnvFile(path.join(projectRoot, '.env'))
  loadEnvFile(path.join(projectRoot, '.env.local'))

  if (!isCloudStorageEnabled()) {
    throw new Error('云存储未启用：请先配置 TOS_* 环境变量后再迁移')
  }

  const dbPath = path.join(projectRoot, 'data', 'playlet.db')
  if (!fs.existsSync(dbPath)) {
    throw new Error(`数据库不存在: ${dbPath}`)
  }

  const db = new Database(dbPath)

  const rows = db.prepare('SELECT id, config, updated_at FROM video_tasks').all() as TaskRow[]
  const updateStmt = db.prepare('UPDATE video_tasks SET config = ?, updated_at = ? WHERE id = ?')
  console.log(`[VideoTaskConfigMigration] 待处理任务数: ${rows.length}`)

  let scanned = 0
  let updated = 0
  let skippedEmpty = 0
  let skippedInvalidJson = 0
  let failed = 0

  for (const row of rows) {
    scanned += 1
    const configSizeMb = row.config ? (Buffer.byteLength(row.config, 'utf8') / 1024 / 1024).toFixed(2) : '0.00'
    console.log(`[VideoTaskConfigMigration] (${scanned}/${rows.length}) 处理任务: ${row.id}, config=${configSizeMb}MB`)

    const rawConfig = row.config?.trim()
    if (!rawConfig) {
      skippedEmpty += 1
      continue
    }

    let parsedConfig: VideoTaskConfig
    try {
      parsedConfig = JSON.parse(rawConfig) as VideoTaskConfig
    } catch {
      skippedInvalidJson += 1
      continue
    }

    try {
      const normalized = await normalizeVideoTaskConfigForStorage({
        taskId: row.id,
        config: parsedConfig
      })

      const nextConfig = JSON.stringify(normalized)
      if (nextConfig === rawConfig) {
        console.log(`[VideoTaskConfigMigration] (${scanned}/${rows.length}) 无需更新: ${row.id}`)
        continue
      }

      updateStmt.run(nextConfig, new Date().toISOString(), row.id)
      updated += 1
      const nextSizeMb = (Buffer.byteLength(nextConfig, 'utf8') / 1024 / 1024).toFixed(4)
      console.log(`[VideoTaskConfigMigration] (${scanned}/${rows.length}) 已更新: ${row.id}, newConfig=${nextSizeMb}MB`)
    } catch (error) {
      failed += 1
      console.error(`[VideoTaskConfigMigration] 任务 ${row.id} 迁移失败:`, error)
    }
  }

  db.pragma('wal_checkpoint(TRUNCATE)')
  db.exec('VACUUM')
  db.close()

  console.log('[VideoTaskConfigMigration] 完成')
  console.log(JSON.stringify({
    scanned,
    updated,
    skippedEmpty,
    skippedInvalidJson,
    failed
  }, null, 2))
}

main().catch((error) => {
  console.error('[VideoTaskConfigMigration] 失败:', error)
  process.exitCode = 1
})
