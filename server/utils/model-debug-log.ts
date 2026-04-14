import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

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

const MODEL_DEBUG_LOG_LIMIT = Number.parseInt(process.env.MODEL_DEBUG_MAX_LOGS || '2000', 10)
const MODEL_DEBUG_LOG_FILE = join(process.cwd(), 'data', 'logs', 'model-debug.jsonl')
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

const entries: ModelDebugLogEntry[] = []
let persistQueue: Promise<void> = Promise.resolve()

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
  entries.push(entry)
  while (entries.length > MODEL_DEBUG_LOG_LIMIT) {
    entries.shift()
  }

  persistQueue = persistQueue
    .then(async () => {
      await fs.mkdir(dirname(MODEL_DEBUG_LOG_FILE), { recursive: true })
      await fs.appendFile(MODEL_DEBUG_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8')
    })
    .catch((error) => {
      console.warn('[ModelDebugLog] 写入日志文件失败:', error)
    })
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
      request: resolveRequest(),
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
      request: resolveRequest(),
      error: normalizeError(error)
    })
    throw error
  }
}

export function listModelDebugLogs(query: ModelDebugLogQuery = {}): ModelDebugLogEntry[] {
  const limit = Math.max(1, Math.min(500, query.limit || 100))
  let result = [...entries].reverse()

  if (query.provider) {
    result = result.filter(item => item.provider === query.provider)
  }

  if (query.operation) {
    result = result.filter(item => item.operation === query.operation)
  }

  if (query.status) {
    result = result.filter(item => item.status === query.status)
  }

  if (query.model) {
    const modelKeyword = query.model.toLowerCase()
    result = result.filter(item => item.model.toLowerCase().includes(modelKeyword))
  }

  if (query.keyword) {
    const keyword = query.keyword.toLowerCase()
    result = result.filter((item) => {
      const haystack = JSON.stringify({
        model: item.model,
        request: item.request,
        response: item.response,
        error: item.error
      }).toLowerCase()
      return haystack.includes(keyword)
    })
  }

  return result.slice(0, limit)
}

export async function clearModelDebugLogs(): Promise<void> {
  entries.length = 0
  try {
    await fs.rm(MODEL_DEBUG_LOG_FILE, { force: true })
  } catch (error) {
    console.warn('[ModelDebugLog] 清理日志文件失败:', error)
  }
}
