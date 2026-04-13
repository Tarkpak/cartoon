import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { TosClient } from '@volcengine/tos-sdk'

const PROJECT_ROOT = process.cwd()
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'manju.db')

const STYLE_DIR = path.join(PROJECT_ROOT, 'public', 'styles')
const VIDEO_DIR = path.join(PROJECT_ROOT, 'public', 'videos')
const GENERATED_IMAGE_DIR = path.join(PROJECT_ROOT, 'data', 'generated-images')
const LEGACY_IMAGE_DIR = path.join(PROJECT_ROOT, 'public', 'generated-images')

function loadEnvFile(filePath) {
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

function parseBoolean(value, fallback = false) {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function trimSlashes(value) {
  return value.replace(/^\/+|\/+$/g, '')
}

function normalizeEndpoint(endpointRaw) {
  const trimmed = String(endpointRaw || '').trim().replace(/\/+$/, '')
  if (!trimmed) return { endpoint: '', protocol: 'https' }

  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed)
    const protocol = parsed.protocol === 'http:' ? 'http' : 'https'
    const normalizedPath = trimSlashes(parsed.pathname || '')
    return {
      endpoint: normalizedPath ? `${parsed.host}/${normalizedPath}` : parsed.host,
      protocol
    }
  }

  return {
    endpoint: trimSlashes(trimmed),
    protocol: 'https'
  }
}

function normalizeObjectPath(value) {
  return trimSlashes(String(value || '')).replace(/\/{2,}/g, '/')
}

function encodeObjectKey(key) {
  return key
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        out.push(fullPath)
      }
    }
  }
  return out
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function stripQueryHash(value) {
  return value.split('?')[0]?.split('#')[0] || value
}

function deepReplaceMedia(value, replacer) {
  if (typeof value === 'string') return replacer(value)
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const replaced = deepReplaceMedia(item, replacer)
      if (replaced !== item) changed = true
      return replaced
    })
    return changed ? next : value
  }
  if (!value || typeof value !== 'object') return value

  const source = value
  let changed = false
  const next = {}
  for (const [key, entry] of Object.entries(source)) {
    const replaced = deepReplaceMedia(entry, replacer)
    next[key] = replaced
    if (replaced !== entry) changed = true
  }
  return changed ? next : value
}

function parseJsonField(raw) {
  if (!raw) return { ok: false, value: null }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false, value: null }
  }
}

function clearDirectoryContents(dir) {
  if (!fs.existsSync(dir)) return 0
  let removed = 0
  const entries = fs.readdirSync(dir)
  for (const entry of entries) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true })
    removed += 1
  }
  return removed
}

async function main() {
  loadEnvFile(path.join(PROJECT_ROOT, '.env'))

  const tosEnabled = parseBoolean(process.env.TOS_ENABLED, true)
  const accessKeyId = (process.env.TOS_ACCESS_KEY || '').trim()
  const accessKeySecret = (process.env.TOS_SECRET_KEY || '').trim()
  const region = (process.env.TOS_REGION || '').trim()
  const bucket = (process.env.TOS_BUCKET || '').trim()
  const keyPrefix = normalizeObjectPath(process.env.TOS_KEY_PREFIX || '')
  const publicBaseUrl = String(process.env.TOS_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  const isCustomDomain = parseBoolean(process.env.TOS_IS_CUSTOM_DOMAIN, false)
  const endpointInfo = normalizeEndpoint(process.env.TOS_ENDPOINT || '')
  const hasRequired = !!(accessKeyId && accessKeySecret && region && bucket && endpointInfo.endpoint)

  if (!tosEnabled || !hasRequired) {
    throw new Error('TOS 未启用或配置不完整，迁移已终止')
  }

  const client = new TosClient({
    accessKeyId,
    accessKeySecret,
    region,
    endpoint: endpointInfo.endpoint,
    secure: endpointInfo.protocol === 'https',
    isCustomDomain
  })

  const joinObjectKey = (...parts) => {
    const normalized = parts
      .map(part => normalizeObjectPath(part || ''))
      .filter(Boolean)
    return normalized.join('/')
  }

  const buildObjectKey = (category, filename) => joinObjectKey(keyPrefix, category, filename)
  const buildPublicUrl = (objectKey) => {
    const encodedKey = encodeObjectKey(objectKey)
    if (publicBaseUrl) return `${publicBaseUrl}/${encodedKey}`
    if (isCustomDomain) return `${endpointInfo.protocol}://${endpointInfo.endpoint}/${encodedKey}`
    return `${endpointInfo.protocol}://${bucket}.${endpointInfo.endpoint}/${encodedKey}`
  }

  const uploadFile = async (filePath, objectKey) => {
    const body = fs.readFileSync(filePath)
    await client.putObject({
      bucket,
      key: objectKey,
      body
    })
    return buildPublicUrl(objectKey)
  }

  const maps = {
    stylePathToUrl: new Map(),
    imageFilenameToUrl: new Map(),
    videoFilenameToUrl: new Map()
  }

  console.log('[MediaMigration] 上传风格缩略图...')
  for (const filePath of walkFiles(STYLE_DIR)) {
    const relative = path.relative(STYLE_DIR, filePath).replace(/\\/g, '/')
    if (!relative) continue
    const key = buildObjectKey('styles', relative)
    const url = await uploadFile(filePath, key)
    maps.stylePathToUrl.set(`/styles/${relative}`, url)
  }

  console.log('[MediaMigration] 上传本地生成图片...')
  for (const dir of [GENERATED_IMAGE_DIR, LEGACY_IMAGE_DIR]) {
    for (const filePath of walkFiles(dir)) {
      const filename = path.basename(filePath)
      if (!filename || maps.imageFilenameToUrl.has(filename)) continue
      const key = buildObjectKey('images', filename)
      const url = await uploadFile(filePath, key)
      maps.imageFilenameToUrl.set(filename, url)
    }
  }

  console.log('[MediaMigration] 上传本地生成视频...')
  for (const filePath of walkFiles(VIDEO_DIR)) {
    const filename = path.basename(filePath)
    if (!filename || maps.videoFilenameToUrl.has(filename)) continue
    const key = buildObjectKey('videos', filename)
    const url = await uploadFile(filePath, key)
    maps.videoFilenameToUrl.set(filename, url)
  }

  const replaceMediaUrl = (rawValue) => {
    const raw = String(rawValue || '').trim()
    if (!raw) return rawValue

    if (raw.startsWith('url:')) {
      return `url:${replaceMediaUrl(raw.slice(4))}`
    }

    if (raw.startsWith('/styles/')) {
      const normalized = stripQueryHash(raw)
      const mapped = maps.stylePathToUrl.get(normalized)
      if (mapped) return mapped
      const relative = normalized.slice('/styles/'.length).replace(/^\/+/, '')
      return relative ? buildPublicUrl(buildObjectKey('styles', relative)) : rawValue
    }

    const normalized = stripQueryHash(raw)
    if (normalized.startsWith('/generated-images/')) {
      const filename = decodeSafe(normalized.slice('/generated-images/'.length))
      const mapped = maps.imageFilenameToUrl.get(filename)
      return mapped || rawValue
    }
    if (normalized.startsWith('/api/image/file/')) {
      const filename = decodeSafe(normalized.slice('/api/image/file/'.length))
      const mapped = maps.imageFilenameToUrl.get(filename)
      return mapped || rawValue
    }
    if (normalized.startsWith('/videos/')) {
      const filename = decodeSafe(normalized.slice('/videos/'.length))
      const mapped = maps.videoFilenameToUrl.get(filename)
      return mapped || rawValue
    }
    if (normalized.startsWith('/api/video/file/')) {
      const filename = decodeSafe(normalized.slice('/api/video/file/'.length))
      const mapped = maps.videoFilenameToUrl.get(filename)
      return mapped || rawValue
    }

    return rawValue
  }

  console.log('[MediaMigration] 更新数据库引用...')
  const db = new Database(DB_PATH)
  const now = new Date().toISOString()

  const sceneRows = db.prepare('SELECT id, first_frame, last_frame, video_url FROM scenes').all()
  const updateSceneStmt = db.prepare(`
    UPDATE scenes
    SET first_frame = ?, last_frame = ?, video_url = ?, updated_at = ?
    WHERE id = ?
  `)
  let sceneUpdates = 0
  for (const row of sceneRows) {
    const nextFirst = row.first_frame ? replaceMediaUrl(row.first_frame) : row.first_frame
    const nextLast = row.last_frame ? replaceMediaUrl(row.last_frame) : row.last_frame
    const nextVideo = row.video_url ? replaceMediaUrl(row.video_url) : row.video_url
    if (nextFirst === row.first_frame && nextLast === row.last_frame && nextVideo === row.video_url) continue
    updateSceneStmt.run(nextFirst || null, nextLast || null, nextVideo || null, now, row.id)
    sceneUpdates += 1
  }

  const characterRows = db.prepare('SELECT id, base_image, expressions, views FROM characters').all()
  const updateCharacterStmt = db.prepare(`
    UPDATE characters
    SET base_image = ?, expressions = ?, views = ?, updated_at = ?
    WHERE id = ?
  `)
  let characterUpdates = 0
  for (const row of characterRows) {
    const nextBase = row.base_image ? replaceMediaUrl(row.base_image) : row.base_image
    const expParsed = parseJsonField(row.expressions)
    const viewsParsed = parseJsonField(row.views)
    const nextExp = expParsed.ok
      ? (() => {
          const replaced = deepReplaceMedia(expParsed.value, replaceMediaUrl)
          return replaced === expParsed.value ? row.expressions : JSON.stringify(replaced)
        })()
      : row.expressions
    const nextViews = viewsParsed.ok
      ? (() => {
          const replaced = deepReplaceMedia(viewsParsed.value, replaceMediaUrl)
          return replaced === viewsParsed.value ? row.views : JSON.stringify(replaced)
        })()
      : row.views

    if (nextBase === row.base_image && nextExp === row.expressions && nextViews === row.views) continue
    updateCharacterStmt.run(nextBase || null, nextExp || null, nextViews || null, now, row.id)
    characterUpdates += 1
  }

  const taskRows = db.prepare('SELECT id, config, video_data, audio_data FROM video_tasks').all()
  const updateTaskStmt = db.prepare(`
    UPDATE video_tasks
    SET config = ?, video_data = ?, audio_data = ?, updated_at = ?
    WHERE id = ?
  `)
  let taskUpdates = 0
  for (const row of taskRows) {
    const cfgParsed = parseJsonField(row.config)
    const nextConfig = cfgParsed.ok
      ? (() => {
          const replaced = deepReplaceMedia(cfgParsed.value, replaceMediaUrl)
          return replaced === cfgParsed.value ? row.config : JSON.stringify(replaced)
        })()
      : row.config
    const nextVideoData = row.video_data ? replaceMediaUrl(row.video_data) : row.video_data
    const nextAudioData = row.audio_data ? replaceMediaUrl(row.audio_data) : row.audio_data
    if (nextConfig === row.config && nextVideoData === row.video_data && nextAudioData === row.audio_data) continue
    updateTaskStmt.run(nextConfig || null, nextVideoData || null, nextAudioData || null, now, row.id)
    taskUpdates += 1
  }

  const configRows = db.prepare('SELECT key, value FROM system_config').all()
  const updateSystemConfigStmt = db.prepare(`
    UPDATE system_config
    SET value = ?, updated_at = ?
    WHERE key = ?
  `)
  let systemConfigUpdates = 0
  for (const row of configRows) {
    const parsed = parseJsonField(row.value)
    if (!parsed.ok) continue
    const replaced = deepReplaceMedia(parsed.value, replaceMediaUrl)
    if (replaced === parsed.value) continue
    updateSystemConfigStmt.run(JSON.stringify(replaced), now, row.key)
    systemConfigUpdates += 1
  }

  db.close()

  console.log('[MediaMigration] 清理本地媒体文件...')
  const cleanupTargets = [
    STYLE_DIR,
    VIDEO_DIR,
    GENERATED_IMAGE_DIR,
    LEGACY_IMAGE_DIR,
    path.join(PROJECT_ROOT, '.output', 'public', 'styles'),
    path.join(PROJECT_ROOT, '.output', 'public', 'videos'),
    path.join(PROJECT_ROOT, '.output', 'public', 'generated-images')
  ]
  const cleanupStats = {}
  for (const dir of cleanupTargets) {
    if (!fs.existsSync(dir)) continue
    const removed = clearDirectoryContents(dir)
    fs.mkdirSync(dir, { recursive: true })
    cleanupStats[path.relative(PROJECT_ROOT, dir)] = removed
  }

  console.log('[MediaMigration] 完成')
  console.log(JSON.stringify({
    uploaded: {
      styles: maps.stylePathToUrl.size,
      images: maps.imageFilenameToUrl.size,
      videos: maps.videoFilenameToUrl.size
    },
    updatedRows: {
      scenes: sceneUpdates,
      characters: characterUpdates,
      videoTasks: taskUpdates,
      systemConfig: systemConfigUpdates
    },
    localCleanup: cleanupStats
  }, null, 2))
}

main().catch((error) => {
  console.error('[MediaMigration] 失败:', error)
  process.exitCode = 1
})
