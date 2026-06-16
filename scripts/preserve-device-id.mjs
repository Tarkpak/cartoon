#!/usr/bin/env node

/**
 * 开发工具：在重装应用前导出设备ID，重装后恢复
 * 用法：
 *   导出: bun run scripts/preserve-device-id.mjs export
 *   恢复: bun run scripts/preserve-device-id.mjs restore
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'

const DB_PATH = join(process.cwd(), 'data/playlet.db')
const BACKUP_PATH = join(process.cwd(), 'data/.device-id-backup.json')
const CONFIG_KEY = 'cloud_device_id'

function exportDeviceId() {
  if (!existsSync(DB_PATH)) {
    console.error('❌ 数据库文件不存在:', DB_PATH)
    process.exit(1)
  }

  const db = new Database(DB_PATH, { readonly: true })

  try {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(CONFIG_KEY)

    if (!row) {
      console.log('⚠️  数据库中未找到设备ID，可能还未登录云端')
      process.exit(0)
    }

    const deviceId = JSON.parse(row.value)
    const backup = {
      deviceId,
      exportedAt: new Date().toISOString()
    }

    writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2))
    console.log('✅ 设备ID已导出到:', BACKUP_PATH)
    console.log('   设备ID:', deviceId)
    console.log('   导出时间:', backup.exportedAt)
  } finally {
    db.close()
  }
}

function restoreDeviceId() {
  if (!existsSync(BACKUP_PATH)) {
    console.error('❌ 备份文件不存在:', BACKUP_PATH)
    console.log('   请先运行: bun run scripts/preserve-device-id.mjs export')
    process.exit(1)
  }

  if (!existsSync(DB_PATH)) {
    console.error('❌ 数据库文件不存在:', DB_PATH)
    console.log('   请先启动应用初始化数据库')
    process.exit(1)
  }

  const backup = JSON.parse(readFileSync(BACKUP_PATH, 'utf-8'))
  const db = new Database(DB_PATH)

  try {
    db.prepare(`
      INSERT OR REPLACE INTO system_config (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run(CONFIG_KEY, JSON.stringify(backup.deviceId))

    console.log('✅ 设备ID已恢复')
    console.log('   设备ID:', backup.deviceId)
    console.log('   原导出时间:', backup.exportedAt)
    console.log('   恢复时间:', new Date().toISOString())
  } finally {
    db.close()
  }
}

const command = process.argv[2]

if (command === 'export') {
  exportDeviceId()
} else if (command === 'restore') {
  restoreDeviceId()
} else {
  console.log('用法:')
  console.log('  导出设备ID: bun run scripts/preserve-device-id.mjs export')
  console.log('  恢复设备ID: bun run scripts/preserve-device-id.mjs restore')
  console.log('')
  console.log('说明:')
  console.log('  在重装应用或清空数据库前，先 export 保存设备ID')
  console.log('  重装后，运行 restore 恢复设备ID，避免触发"设备数量已达到上限"')
  process.exit(1)
}
