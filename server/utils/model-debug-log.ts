import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { initDatabase, sqlite } from '../db'
import { persistImageToPublic } from './image-storage'
import { persistAudioSourceToCloud } from './audio-storage'
import { persistVideoSourceToCloud } from './video-storage'

export type ModelDebugStatus = 'success' | 'error'

export interface ModelDebugErrorInfo {
  name?: string
  message: string
  stack?: string
}

export interface ModelDebugLogEntry {
  id: string
  timestamp: string
  provider: string
  model: string
  operation: string
  status: ModelDebugStatus
  durationMs: number
  request?: unknown
  requestRaw?: unknown
  response?: unknown
  responseRaw?: unknown
  mediaRefs?: ModelDebugMediaRef[]
  error?: ModelDebugErrorInfo
}

export interface ModelDebugMediaRef {
  id: string
  direction: 'request' | 'response'
  path: string
  mediaType: 'image' | 'audio' | 'video' | 'binary'
  mimeType?: string
  originalLength: number
  url?: string
  status: 'ready' | 'failed' | 'skipped'
  note?: string
}

export interface ModelDebugLogQuery {
  limit?: number
  provider?: string
  model?: string
  operation?: string
  status?: ModelDebugStatus
  keyword?: string
}

type ModelDebugRequestValue = unknown | (() => unknown)

const parsedLogLimit = Number.parseInt(process.env.MODEL_DEBUG_MAX_LOGS || '2000', 10)
const MODEL_DEBUG_LOG_LIMIT = Number.isFinite(parsedLogLimit) && parsedLogLimit > 0 ? parsedLogLimit : 2000
const LEGACY_MODEL_DEBUG_LOG_FILE = join(process.cwd(), 'data', 'logs', 'model-debug.jsonl')
const LEGACY_MODEL_DEBUG_LOG_MIGRATED_FILE = `${LEGACY_MODEL_DEBUG_LOG_FILE}.migrated`
const MAX_STRING_LENGTH = 2000
const MAX_RAW_STRING_LENGTH = 20000
const MAX_OBJECT_KEYS = 50
const MAX_ARRAY_LENGTH = 25
const MAX_DEPTH = 5
const MAX_RAW_OBJECT_KEYS = 200
const MAX_RAW_ARRAY_LENGTH = 100
const MAX_RAW_DEPTH = 8
const MAX_MEDIA_REFERENCES = 12
const MAX_MEDIA_UPLOAD_SOURCE_LENGTH = 8 * 1024 * 1024

const SENSITIVE_KEY_PATTERNS = [
  'api_key',
  'apikey',
  'authorization',
  'token',
  'secret',
  'password',
  'access_key',
  'secret_key'
]

let persistQueue: Promise<void> = Promise.resolve()
let legacyMigrationAttempted = false

type SqliteStatement = ReturnType<typeof sqlite.prepare>

interface ModelDebugStatements {
  insertLogStmt: SqliteStatement
  pruneLogStmt: SqliteStatement
  clearLogsStmt: SqliteStatement
}

let modelDebugStatements: ModelDebugStatements | null = null

function getModelDebugStatements(): ModelDebugStatements {
  if (modelDebugStatements) return modelDebugStatements

  // 构建/预渲染阶段会先加载模块，再执行 Nitro 插件，需先确保表结构已创建
  initDatabase()

  modelDebugStatements = {
    insertLogStmt: sqlite.prepare(`
      INSERT OR REPLACE INTO model_debug_logs (
        id, timestamp, provider, model, operation, status, duration_ms,
        request_json, request_raw_json, response_json, response_raw_json, media_refs_json, error_json, created_at
      ) VALUES (
        @id, @timestamp, @provider, @model, @operation, @status, @durationMs,
        @requestJson, @requestRawJson, @responseJson, @responseRawJson, @mediaRefsJson, @errorJson, @createdAt
      )
    `),
    pruneLogStmt: sqlite.prepare(`
      DELETE FROM model_debug_logs
      WHERE id NOT IN (
        SELECT id FROM model_debug_logs
        ORDER BY timestamp DESC
        LIMIT ?
      )
    `),
    clearLogsStmt: sqlite.prepare('DELETE FROM model_debug_logs')
  }

  return modelDebugStatements
}

interface ModelDebugLogRow {
  id: string
  timestamp: string
  provider: string
  model: string
  operation: string
  status: string
  duration_ms: number
  request_json: string | null
  request_raw_json: string | null
  response_json: string | null
  response_raw_json: string | null
  media_refs_json: string | null
  error_json: string | null
}

interface ModelDebugLogPersistParams {
  id: string
  timestamp: string
  provider: string
  model: string
  operation: string
  status: ModelDebugStatus
  durationMs: number
  requestJson: string | null
  requestRawJson: string | null
  responseJson: string | null
  responseRawJson: string | null
  mediaRefsJson: string | null
  errorJson: string | null
  createdAt: string
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_KEY_PATTERNS.some(pattern => lower.includes(pattern))
}

function looksLikeBase64(input: string): boolean {
  if (input.length < 120) return false
  return /^[A-Za-z0-9+/=\r\n]+$/.test(input)
}

function sanitizeString(input: string): string {
  const trimmed = input.trim()

  if (trimmed.startsWith('data:') && trimmed.includes(';base64,')) {
    const [prefix, payload = ''] = trimmed.split(',', 2)
    return `[data-uri len=${trimmed.length} payload=${payload.length}] ${prefix},...`
  }

  if (looksLikeBase64(trimmed)) {
    return `[base64 len=${trimmed.length}]`
  }

  if (trimmed.length > MAX_STRING_LENGTH) {
    return `${trimmed.slice(0, MAX_STRING_LENGTH)}... [truncated ${trimmed.length - MAX_STRING_LENGTH} chars]`
  }

  return trimmed
}

function sanitizeRawString(input: string): string {
  if (input.length > MAX_RAW_STRING_LENGTH) {
    return `${input.slice(0, MAX_RAW_STRING_LENGTH)}... [truncated ${input.length - MAX_RAW_STRING_LENGTH} chars]`
  }
  return input
}

function sanitizeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message || 'Unknown error'),
      stack: value.stack ? sanitizeString(value.stack) : undefined
    }
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `[Array(${value.length})]`
    const items = value.slice(0, MAX_ARRAY_LENGTH).map(item => sanitizeValue(item, depth + 1, seen))
    if (value.length > MAX_ARRAY_LENGTH) {
      items.push(`[+${value.length - MAX_ARRAY_LENGTH} more items]`)
    }
    return items
  }

  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>

    if (seen.has(objectValue)) return '[Circular]'
    seen.add(objectValue)

    if (depth >= MAX_DEPTH) return '[Object]'

    const objectEntries = Object.entries(objectValue)
    const limitedEntries = objectEntries.slice(0, MAX_OBJECT_KEYS)
    const sanitizedObject: Record<string, unknown> = {}

    for (const [key, item] of limitedEntries) {
      sanitizedObject[key] = isSensitiveKey(key) ? '[REDACTED]' : sanitizeValue(item, depth + 1, seen)
    }

    if (objectEntries.length > MAX_OBJECT_KEYS) {
      sanitizedObject.__truncated__ = `+${objectEntries.length - MAX_OBJECT_KEYS} keys`
    }

    return sanitizedObject
  }

  return String(value)
}

type MediaCandidate = {
  mediaType: 'image' | 'audio' | 'video' | 'binary'
  mimeType?: string
  source: string
  originalLength: number
}

function inferMediaTypeFromPath(path: string): 'image' | 'audio' | 'video' | 'binary' {
  const lower = path.toLowerCase()
  if (/(image|avatar|thumbnail|frame|picture|photo|poster|cover)/.test(lower)) return 'image'
  if (/(audio|voice|speech|tts|sound|wav|mp3)/.test(lower)) return 'audio'
  if (/(video|movie|clip|mv)/.test(lower)) return 'video'
  return 'binary'
}

function buildPath(parentPath: string, key: string | number): string {
  if (parentPath === '$') {
    return typeof key === 'number' ? `$[${key}]` : `$.${key}`
  }
  return typeof key === 'number' ? `${parentPath}[${key}]` : `${parentPath}.${key}`
}

function detectMediaCandidate(value: string, path: string): MediaCandidate | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const dataUriMatch = trimmed.match(/^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (dataUriMatch?.[1] && dataUriMatch[2]) {
    const mimeType = dataUriMatch[1].toLowerCase()
    const mediaType = mimeType.startsWith('image/')
      ? 'image'
      : mimeType.startsWith('audio/')
        ? 'audio'
        : mimeType.startsWith('video/')
          ? 'video'
          : 'binary'
    return {
      mediaType,
      mimeType,
      source: trimmed,
      originalLength: trimmed.length
    }
  }

  if (!looksLikeBase64(trimmed)) return null
  const inferredMediaType = inferMediaTypeFromPath(path)
  if (inferredMediaType === 'binary') return null

  const defaultMimeType = inferredMediaType === 'image'
    ? 'image/png'
    : inferredMediaType === 'audio'
      ? 'audio/mpeg'
      : 'video/mp4'
  return {
    mediaType: inferredMediaType,
    mimeType: defaultMimeType,
    source: `data:${defaultMimeType};base64,${trimmed}`,
    originalLength: trimmed.length
  }
}

async function persistMediaCandidate(
  candidate: MediaCandidate,
  direction: 'request' | 'response',
  path: string,
  index: number
): Promise<ModelDebugMediaRef> {
  const id = `media_${direction}_${index}`
  if (candidate.source.length > MAX_MEDIA_UPLOAD_SOURCE_LENGTH) {
    return {
      id,
      direction,
      path,
      mediaType: candidate.mediaType,
      mimeType: candidate.mimeType,
      originalLength: candidate.originalLength,
      status: 'skipped',
      note: `媒体字段过大，已跳过上传（>${MAX_MEDIA_UPLOAD_SOURCE_LENGTH} chars）`
    }
  }

  if (candidate.mediaType === 'binary') {
    return {
      id,
      direction,
      path,
      mediaType: candidate.mediaType,
      mimeType: candidate.mimeType,
      originalLength: candidate.originalLength,
      status: 'skipped',
      note: '非图片/音频/视频字段，已跳过上传'
    }
  }

  try {
    const url = candidate.mediaType === 'image'
      ? await persistImageToPublic({
          source: candidate.source,
          prefix: 'model_debug_image'
        })
      : candidate.mediaType === 'audio'
        ? await persistAudioSourceToCloud({
            source: candidate.source,
            prefix: 'model_debug_audio',
            category: 'model-debug-audio'
          })
        : await persistVideoSourceToCloud({
            source: candidate.source,
            prefix: 'model_debug_video',
            category: 'model-debug-video'
          })

    return {
      id,
      direction,
      path,
      mediaType: candidate.mediaType,
      mimeType: candidate.mimeType,
      originalLength: candidate.originalLength,
      url,
      status: 'ready'
    }
  } catch (error) {
    return {
      id,
      direction,
      path,
      mediaType: candidate.mediaType,
      mimeType: candidate.mimeType,
      originalLength: candidate.originalLength,
      status: 'failed',
      note: error instanceof Error ? error.message : '媒体上传失败'
    }
  }
}

async function normalizeLogValue(
  value: unknown,
  options: {
    direction: 'request' | 'response'
    path: string
    depth: number
    seen: WeakSet<object>
    mediaRefs: ModelDebugMediaRef[]
  }
): Promise<{ raw: unknown, view: unknown }> {
  if (value === null || value === undefined) {
    return { raw: value, view: value }
  }

  if (typeof value === 'string') {
    const mediaCandidate = detectMediaCandidate(value, options.path)
    if (mediaCandidate) {
      if (options.mediaRefs.length >= MAX_MEDIA_REFERENCES) {
        const skipped: ModelDebugMediaRef = {
          id: `media_${options.direction}_${options.mediaRefs.length + 1}`,
          direction: options.direction,
          path: options.path,
          mediaType: mediaCandidate.mediaType,
          mimeType: mediaCandidate.mimeType,
          originalLength: mediaCandidate.originalLength,
          status: 'skipped',
          note: `媒体字段超过上限（${MAX_MEDIA_REFERENCES}），已跳过`
        }
        options.mediaRefs.push(skipped)
        return {
          raw: {
            __media_ref__: skipped.id,
            mediaType: skipped.mediaType,
            mimeType: skipped.mimeType || null,
            status: skipped.status,
            note: skipped.note,
            originalLength: skipped.originalLength
          },
          view: `[${skipped.mediaType}] ${skipped.note}`
        }
      }

      const ref = await persistMediaCandidate(
        mediaCandidate,
        options.direction,
        options.path,
        options.mediaRefs.length + 1
      )
      options.mediaRefs.push(ref)

      return {
        raw: {
          __media_ref__: ref.id,
          mediaType: ref.mediaType,
          mimeType: ref.mimeType || null,
          status: ref.status,
          url: ref.url || null,
          note: ref.note,
          originalLength: ref.originalLength
        },
        view: ref.url
          ? `[${ref.mediaType}] ${ref.url}`
          : `[${ref.mediaType}] ${ref.note || ref.status}`
      }
    }

    return {
      raw: sanitizeRawString(value),
      view: sanitizeString(value)
    }
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return { raw: value, view: value }
  }

  if (typeof value === 'bigint') {
    const text = value.toString()
    return { raw: text, view: text }
  }

  if (value instanceof Date) {
    const text = value.toISOString()
    return { raw: text, view: text }
  }

  if (value instanceof Error) {
    return normalizeLogValue({
      name: value.name,
      message: value.message,
      stack: value.stack
    }, options)
  }

  if (Array.isArray(value)) {
    const length = value.length
    const rawDepthExceeded = options.depth >= MAX_RAW_DEPTH
    const viewDepthExceeded = options.depth >= MAX_DEPTH
    if (rawDepthExceeded && viewDepthExceeded) {
      return {
        raw: `[Array(${length})]`,
        view: `[Array(${length})]`
      }
    }

    const maxTraverseLength = Math.min(length, Math.max(MAX_RAW_ARRAY_LENGTH, MAX_ARRAY_LENGTH))
    const normalizedItems: Array<{ raw: unknown, view: unknown }> = []
    for (let index = 0; index < maxTraverseLength; index++) {
      normalizedItems.push(await normalizeLogValue(value[index], {
        ...options,
        path: buildPath(options.path, index),
        depth: options.depth + 1
      }))
    }

    const rawItems = rawDepthExceeded
      ? `[Array(${length})]`
      : normalizedItems.slice(0, MAX_RAW_ARRAY_LENGTH).map(item => item.raw)
    const viewItems = viewDepthExceeded
      ? `[Array(${length})]`
      : normalizedItems.slice(0, MAX_ARRAY_LENGTH).map(item => item.view)

    if (Array.isArray(rawItems) && length > MAX_RAW_ARRAY_LENGTH) {
      rawItems.push(`[+${length - MAX_RAW_ARRAY_LENGTH} more items]`)
    }
    if (Array.isArray(viewItems) && length > MAX_ARRAY_LENGTH) {
      viewItems.push(`[+${length - MAX_ARRAY_LENGTH} more items]`)
    }

    return {
      raw: rawItems,
      view: viewItems
    }
  }

  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>
    if (options.seen.has(objectValue)) {
      return { raw: '[Circular]', view: '[Circular]' }
    }
    options.seen.add(objectValue)

    const rawDepthExceeded = options.depth >= MAX_RAW_DEPTH
    const viewDepthExceeded = options.depth >= MAX_DEPTH
    if (rawDepthExceeded && viewDepthExceeded) {
      return { raw: '[Object]', view: '[Object]' }
    }

    const entries = Object.entries(objectValue)
    const maxTraverseKeys = Math.min(entries.length, Math.max(MAX_RAW_OBJECT_KEYS, MAX_OBJECT_KEYS))
    const rawResult: Record<string, unknown> = {}
    const viewResult: Record<string, unknown> = {}

    for (let index = 0; index < maxTraverseKeys; index++) {
      const [key = '', item] = entries[index] || []
      if (!key) continue

      if (isSensitiveKey(key)) {
        rawResult[key] = '[REDACTED]'
        viewResult[key] = '[REDACTED]'
        continue
      }

      const normalized = await normalizeLogValue(item, {
        ...options,
        path: buildPath(options.path, key),
        depth: options.depth + 1
      })

      if (!rawDepthExceeded && index < MAX_RAW_OBJECT_KEYS) {
        rawResult[key] = normalized.raw
      }
      if (!viewDepthExceeded && index < MAX_OBJECT_KEYS) {
        viewResult[key] = normalized.view
      }
    }

    if (!rawDepthExceeded && entries.length > MAX_RAW_OBJECT_KEYS) {
      rawResult.__truncated__ = `+${entries.length - MAX_RAW_OBJECT_KEYS} keys`
    }
    if (!viewDepthExceeded && entries.length > MAX_OBJECT_KEYS) {
      viewResult.__truncated__ = `+${entries.length - MAX_OBJECT_KEYS} keys`
    }

    return {
      raw: rawDepthExceeded ? '[Object]' : rawResult,
      view: viewDepthExceeded ? '[Object]' : viewResult
    }
  }

  const text = String(value)
  return { raw: text, view: text }
}

async function normalizeLogPayload(
  direction: 'request' | 'response',
  value: unknown
): Promise<{ raw: unknown, view: unknown, mediaRefs: ModelDebugMediaRef[] }> {
  const mediaRefs: ModelDebugMediaRef[] = []
  const normalized = await normalizeLogValue(value, {
    direction,
    path: '$',
    depth: 0,
    seen: new WeakSet<object>(),
    mediaRefs
  })

  return {
    raw: normalized.raw,
    view: normalized.view,
    mediaRefs
  }
}

function normalizeError(error: unknown): ModelDebugErrorInfo {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeString(error.message || 'Unknown error'),
      stack: error.stack ? sanitizeString(error.stack) : undefined
    }
  }

  if (typeof error === 'string') {
    return { message: sanitizeString(error) }
  }

  return {
    message: sanitizeString(JSON.stringify(sanitizeValue(error)))
  }
}

function pushEntry(entry: ModelDebugLogEntry) {
  migrateLegacyLogsIfNeeded()
  persistQueue = persistQueue
    .then(() => {
      const { insertLogStmt, pruneLogStmt } = getModelDebugStatements()
      insertLogStmt.run(toPersistParams(entry))
      pruneLogStmt.run(MODEL_DEBUG_LOG_LIMIT)
    })
    .catch((error) => {
      console.warn('[ModelDebugLog] 写入数据库失败:', error)
    })
}

function serializeForStorage(value: unknown): string | null {
  if (value === undefined) return null
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({
      __serialize_error__: 'value cannot be serialized'
    })
  }
}

function toPersistParams(entry: ModelDebugLogEntry): ModelDebugLogPersistParams {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    provider: entry.provider,
    model: entry.model,
    operation: entry.operation,
    status: entry.status,
    durationMs: entry.durationMs,
    requestJson: serializeForStorage(entry.request),
    requestRawJson: serializeForStorage(entry.requestRaw),
    responseJson: serializeForStorage(entry.response),
    responseRawJson: serializeForStorage(entry.responseRaw),
    mediaRefsJson: serializeForStorage(entry.mediaRefs),
    errorJson: serializeForStorage(entry.error),
    createdAt: entry.timestamp
  }
}

function parseStoredJson(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function normalizeStoredError(value: unknown): ModelDebugErrorInfo | undefined {
  if (!value) return undefined
  if (typeof value === 'string') {
    return { message: sanitizeString(value) }
  }

  if (typeof value === 'object') {
    const raw = value as Record<string, unknown>
    if (typeof raw.message === 'string') {
      return {
        name: typeof raw.name === 'string' ? raw.name : undefined,
        message: sanitizeString(raw.message),
        stack: typeof raw.stack === 'string' ? sanitizeString(raw.stack) : undefined
      }
    }
  }

  return {
    message: sanitizeString(JSON.stringify(sanitizeValue(value)))
  }
}

function rowToLogEntry(row: ModelDebugLogRow): ModelDebugLogEntry {
  const parsedMediaRefs = parseStoredJson(row.media_refs_json)
  return {
    id: row.id,
    timestamp: row.timestamp,
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    status: row.status === 'error' ? 'error' : 'success',
    durationMs: Number.isFinite(row.duration_ms) ? row.duration_ms : 0,
    request: parseStoredJson(row.request_json),
    requestRaw: parseStoredJson(row.request_raw_json) ?? parseStoredJson(row.request_json),
    response: parseStoredJson(row.response_json),
    responseRaw: parseStoredJson(row.response_raw_json) ?? parseStoredJson(row.response_json),
    mediaRefs: Array.isArray(parsedMediaRefs) ? parsedMediaRefs as ModelDebugMediaRef[] : [],
    error: normalizeStoredError(parseStoredJson(row.error_json))
  }
}

function migrateLegacyLogsIfNeeded() {
  if (legacyMigrationAttempted) return
  legacyMigrationAttempted = true

  try {
    const { insertLogStmt, pruneLogStmt } = getModelDebugStatements()

    if (!existsSync(LEGACY_MODEL_DEBUG_LOG_FILE)) return

    const row = sqlite.prepare('SELECT COUNT(1) as count FROM model_debug_logs').get() as { count?: number } | undefined
    if ((row?.count || 0) > 0) {
      renameLegacyLogFile()
      return
    }

    const content = readFileSync(LEGACY_MODEL_DEBUG_LOG_FILE, 'utf8')
    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)

    if (lines.length === 0) {
      renameLegacyLogFile()
      return
    }

    const entries: ModelDebugLogEntry[] = []
    for (const line of lines.slice(-MODEL_DEBUG_LOG_LIMIT)) {
      try {
        const raw = JSON.parse(line) as Partial<ModelDebugLogEntry>
        if (
          typeof raw.provider !== 'string'
          || typeof raw.model !== 'string'
          || typeof raw.operation !== 'string'
        ) {
          continue
        }

        const duration = typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
          ? Math.max(0, Math.round(raw.durationMs))
          : 0
        const timestamp = typeof raw.timestamp === 'string' && raw.timestamp
          ? raw.timestamp
          : new Date().toISOString()

        entries.push({
          id: typeof raw.id === 'string' && raw.id ? raw.id : createLogId(),
          timestamp,
          provider: raw.provider,
          model: raw.model,
          operation: raw.operation,
          status: raw.status === 'error' ? 'error' : 'success',
          durationMs: duration,
          request: sanitizeValue(raw.request),
          requestRaw: sanitizeValue(raw.request),
          response: sanitizeValue(raw.response),
          responseRaw: sanitizeValue(raw.response),
          mediaRefs: [],
          error: raw.error ? normalizeStoredError(raw.error) : undefined
        })
      } catch {
        continue
      }
    }

    if (entries.length === 0) {
      renameLegacyLogFile()
      return
    }

    const insertInTransaction = sqlite.transaction((records: ModelDebugLogPersistParams[]) => {
      for (const record of records) {
        insertLogStmt.run(record)
      }
    })

    insertInTransaction(entries.map(toPersistParams))
    pruneLogStmt.run(MODEL_DEBUG_LOG_LIMIT)
    renameLegacyLogFile()
    console.log(`[ModelDebugLog] 已迁移 ${entries.length} 条历史日志到 SQLite`)
  } catch (error) {
    console.warn('[ModelDebugLog] 迁移旧日志失败:', error)
  }
}

function renameLegacyLogFile() {
  try {
    if (!existsSync(LEGACY_MODEL_DEBUG_LOG_FILE)) return
    renameSync(LEGACY_MODEL_DEBUG_LOG_FILE, LEGACY_MODEL_DEBUG_LOG_MIGRATED_FILE)
  } catch {
    // 忽略重命名失败，避免影响主流程
  }
}

function createLogId(): string {
  return `mdl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export async function withModelDebugLog<T>(params: {
  provider: string
  model: string
  operation: string
  request?: ModelDebugRequestValue
  execute: () => Promise<T>
  summarizeResponse?: (result: T) => unknown
}): Promise<T> {
  const startedAt = Date.now()
  const timestamp = new Date().toISOString()
  const id = createLogId()
  const resolveRequest = () => {
    if (typeof params.request === 'function') {
      try {
        return (params.request as () => unknown)()
      } catch (error) {
        return {
          __request_resolve_error__: normalizeError(error)
        }
      }
    }
    return params.request
  }

  try {
    const result = await params.execute()
    const requestPayload = await normalizeLogPayload('request', resolveRequest())
    const responsePayload = await normalizeLogPayload(
      'response',
      params.summarizeResponse ? params.summarizeResponse(result) : result
    )

    pushEntry({
      id,
      timestamp,
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      status: 'success',
      durationMs: Date.now() - startedAt,
      request: requestPayload.view,
      requestRaw: requestPayload.raw,
      response: responsePayload.view,
      responseRaw: responsePayload.raw,
      mediaRefs: [...requestPayload.mediaRefs, ...responsePayload.mediaRefs]
    })
    return result
  } catch (error) {
    const requestPayload = await normalizeLogPayload('request', resolveRequest())
    pushEntry({
      id,
      timestamp,
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      status: 'error',
      durationMs: Date.now() - startedAt,
      request: requestPayload.view,
      requestRaw: requestPayload.raw,
      mediaRefs: requestPayload.mediaRefs,
      error: normalizeError(error)
    })
    throw error
  }
}

export function listModelDebugLogs(query: ModelDebugLogQuery = {}): ModelDebugLogEntry[] {
  getModelDebugStatements()
  migrateLegacyLogsIfNeeded()
  const limit = Math.max(1, Math.min(500, query.limit || 100))
  const whereParts: string[] = []
  const params: Array<string | number> = []

  if (query.provider) {
    whereParts.push('provider = ?')
    params.push(query.provider)
  }

  if (query.operation) {
    whereParts.push('operation = ?')
    params.push(query.operation)
  }

  if (query.status) {
    whereParts.push('status = ?')
    params.push(query.status)
  }

  if (query.model) {
    whereParts.push('LOWER(model) LIKE ?')
    params.push(`%${query.model.toLowerCase()}%`)
  }

  if (query.keyword) {
    const keyword = `%${query.keyword.toLowerCase()}%`
    whereParts.push(`
      (
        LOWER(model) LIKE ?
        OR LOWER(COALESCE(request_json, '')) LIKE ?
        OR LOWER(COALESCE(request_raw_json, '')) LIKE ?
        OR LOWER(COALESCE(response_json, '')) LIKE ?
        OR LOWER(COALESCE(response_raw_json, '')) LIKE ?
        OR LOWER(COALESCE(media_refs_json, '')) LIKE ?
        OR LOWER(COALESCE(error_json, '')) LIKE ?
      )
    `)
    params.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword)
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
  const rows = sqlite.prepare(`
    SELECT
      id,
      timestamp,
      provider,
      model,
      operation,
      status,
      duration_ms,
      request_json,
      request_raw_json,
      response_json,
      response_raw_json,
      media_refs_json,
      error_json
    FROM model_debug_logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...params, limit) as ModelDebugLogRow[]

  return rows.map(rowToLogEntry)
}

export async function clearModelDebugLogs(): Promise<void> {
  const { clearLogsStmt } = getModelDebugStatements()
  migrateLegacyLogsIfNeeded()
  await persistQueue
  ;(clearLogsStmt as { run: (...params: unknown[]) => unknown }).run()
}
