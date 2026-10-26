// 清理本地 SQLite 中模型调用日志里的内嵌 base64 媒体，并 VACUUM 回收空间。
// 用法：bun run db:clean-log-media [数据库路径] [--dry-run] [--no-vacuum]
// 运行前请先关闭桌面应用和本地后端。
import { Database } from 'bun:sqlite'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OMITTED_NOTE = '内嵌 base64 媒体未保存到日志，避免日志体积过大'

function defaultDbPath(): string {
  if (process.env.PLAYLET_DB_PATH) return process.env.PLAYLET_DB_PATH
  const appDir = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'com.playlet.desktop')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'com.playlet.desktop')
      : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'com.playlet.desktop')
  return join(appDir, 'data', 'playlet.db')
}

function stripRefs(refs: unknown): boolean {
  if (!Array.isArray(refs)) return false
  let changed = false
  for (const item of refs) {
    if (item && typeof item === 'object' && typeof item.url === 'string' && item.url.trimStart().startsWith('data:')) {
      delete item.url
      item.status = 'omitted'
      item.note = OMITTED_NOTE
      changed = true
    }
  }
  return changed
}

function stripJson(raw: string | null, pick: (value: any) => unknown): string | null {
  if (!raw || !raw.includes(';base64,')) return raw
  try {
    const value = JSON.parse(raw)
    return stripRefs(pick(value)) ? JSON.stringify(value) : raw
  } catch {
    return raw
  }
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const skipVacuum = args.includes('--no-vacuum')
const dbPath = args.find(arg => !arg.startsWith('--')) || defaultDbPath()

if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}`)
  process.exit(1)
}

const sizeBefore = statSync(dbPath).size
console.log(`数据库：${dbPath}（${formatMB(sizeBefore)}）`)

const db = new Database(dbPath, { readonly: dryRun })
const rows = db.query(`SELECT id, media_refs_json, cloud_payload_json FROM model_debug_logs
  WHERE instr(media_refs_json, ';base64,') > 0 OR instr(cloud_payload_json, ';base64,') > 0`).all() as Array<{
  id: string
  media_refs_json: string | null
  cloud_payload_json: string | null
}>

let savedBytes = 0
const updates: Array<[string | null, string | null, string]> = []
for (const row of rows) {
  const mediaRefs = stripJson(row.media_refs_json, value => value)
  const cloudPayload = stripJson(row.cloud_payload_json, value => value?.mediaRefs)
  const saved = (row.media_refs_json?.length ?? 0) - (mediaRefs?.length ?? 0)
    + (row.cloud_payload_json?.length ?? 0) - (cloudPayload?.length ?? 0)
  if (saved > 0) {
    savedBytes += saved
    updates.push([mediaRefs, cloudPayload, row.id])
  }
}

console.log(`含内嵌媒体的日志：${updates.length} 条，可清理约 ${formatMB(savedBytes)}`)

if (dryRun) {
  console.log('--dry-run：未做任何修改')
  process.exit(0)
}

try {
  db.exec('BEGIN IMMEDIATE')
} catch {
  console.error('数据库正被占用，请先关闭桌面应用 / 本地后端后重试')
  process.exit(1)
}
const update = db.prepare('UPDATE model_debug_logs SET media_refs_json = ?1, cloud_payload_json = ?2 WHERE id = ?3')
for (const params of updates) update.run(...params)
db.exec('COMMIT')
console.log(`已清理 ${updates.length} 条日志`)

if (skipVacuum) {
  console.log('--no-vacuum：跳过空间回收')
} else {
  console.log('正在 VACUUM 回收空间（需要约等于数据库大小的临时磁盘空间）…')
  db.exec('VACUUM')
  db.close()
  const sizeAfter = statSync(dbPath).size
  console.log(`完成：${formatMB(sizeBefore)} → ${formatMB(sizeAfter)}`)
}
