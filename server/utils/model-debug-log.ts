import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { sqlite } from '../db'

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
  response?: unknown
  error?: ModelDebugErrorInfo
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
const MAX_OBJECT_KEYS = 50
const MAX_ARRAY_LENGTH = 25
const MAX_DEPTH = 5

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

const insertLogStmt = sqlite.prepare(`
  INSERT OR REPLACE INTO model_debug_logs (
    id, timestamp, provider, model, operation, status, duration_ms,
    request_json, response_json, error_json, created_at
  ) VALUES (
    @id, @timestamp, @provider, @model, @operation, @status, @durationMs,
    @requestJson, @responseJson, @errorJson, @createdAt
  )
`)

const pruneLogStmt = sqlite.prepare(`
  DELETE FROM model_debug_logs
  WHERE id NOT IN (
    SELECT id FROM model_debug_logs
    ORDER BY timestamp DESC
    LIMIT ?
  )
`)

const clearLogsStmt = sqlite.prepare('DELETE FROM model_debug_logs')

interface ModelDebugLogRow {
  id: string
  timestamp: string
  provider: string
  model: string
  operation: string
  status: string
  duration_ms: number
  request_json: string | null
  response_json: string | null
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
  responseJson: string | null
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
    responseJson: serializeForStorage(entry.response),
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
  return {
    id: row.id,
    timestamp: row.timestamp,
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    status: row.status === 'error' ? 'error' : 'success',
    durationMs: Number.isFinite(row.duration_ms) ? row.duration_ms : 0,
    request: parseStoredJson(row.request_json),
    response: parseStoredJson(row.response_json),
    error: normalizeStoredError(parseStoredJson(row.error_json))
  }
}

function migrateLegacyLogsIfNeeded() {
  if (legacyMigrationAttempted) return
  legacyMigrationAttempted = true

  try {
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
          response: sanitizeValue(raw.response),
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
    pushEntry({
      id,
      timestamp,
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      status: 'success',
      durationMs: Date.now() - startedAt,
      request: sanitizeValue(resolveRequest()),
      response: sanitizeValue(params.summarizeResponse ? params.summarizeResponse(result) : result)
    })
    return result
  } catch (error) {
    pushEntry({
      id,
      timestamp,
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      status: 'error',
      durationMs: Date.now() - startedAt,
      request: sanitizeValue(resolveRequest()),
      error: normalizeError(error)
    })
    throw error
  }
}

export function listModelDebugLogs(query: ModelDebugLogQuery = {}): ModelDebugLogEntry[] {
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
        OR LOWER(COALESCE(response_json, '')) LIKE ?
        OR LOWER(COALESCE(error_json, '')) LIKE ?
      )
    `)
    params.push(keyword, keyword, keyword, keyword)
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
      response_json,
      error_json
    FROM model_debug_logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...params, limit) as ModelDebugLogRow[]

  return rows.map(rowToLogEntry)
}

export async function clearModelDebugLogs(): Promise<void> {
  migrateLegacyLogsIfNeeded()
  await persistQueue
  clearLogsStmt.run()
}
