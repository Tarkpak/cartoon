/**
 * 可灵 AI (Kling AI) API 封装
 * 文档参考: https://klingai.com/document-api/apiReference/commonInfo
 */

import { createHmac } from 'node:crypto'

// ============================================================
// 错误类型定义
// ============================================================

export enum KlingErrorCode {
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NOT_FOUND = 'NOT_FOUND',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',
  INTERNAL = 'INTERNAL',
  UNAVAILABLE = 'UNAVAILABLE',
  DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED',
  UNKNOWN = 'UNKNOWN'
}

export class KlingError extends Error {
  constructor(
    message: string,
    public code: KlingErrorCode,
    public status?: number,
    public retryable: boolean = false
  ) {
    super(message)
    this.name = 'KlingError'
  }
}

const RETRYABLE_ERROR_CODES = new Set([
  KlingErrorCode.RESOURCE_EXHAUSTED,
  KlingErrorCode.INTERNAL,
  KlingErrorCode.UNAVAILABLE,
  KlingErrorCode.DEADLINE_EXCEEDED
])

// ============================================================
// 模型配置
// ============================================================

export const KlingVideoModels = {
  KLING_V1: 'kling-v1',
  KLING_V1_5: 'kling-v1-5',
  KLING_V1_6: 'kling-v1-6',
  KLING_V2_MASTER: 'kling-v2-master',
  KLING_V2_1: 'kling-v2-1',
  KLING_V2_1_MASTER: 'kling-v2-1-master',
  KLING_V2_5_TURBO: 'kling-v2-5-turbo',
  KLING_V2_6: 'kling-v2-6',
  KLING_V3: 'kling-v3'
} as const

// ============================================================
// 配置
// ============================================================

const DEFAULT_BASE_URL = 'https://api-beijing.klingai.com'
const JWT_TTL_SECONDS = 30 * 60

interface KlingConfig {
  accessKey: string
  secretKey: string
  baseUrl: string
}

let config: KlingConfig | null = null

function getConfig(): KlingConfig {
  if (!config) {
    const runtimeConfig = useRuntimeConfig()
    const accessKey = (runtimeConfig.klingAccessKey as string) || ''
    const secretKey = (runtimeConfig.klingSecretKey as string) || ''
    const baseUrl = ((runtimeConfig.klingBaseUrl as string) || DEFAULT_BASE_URL).replace(/\/+$/, '')

    if (!accessKey || !secretKey) {
      throw new KlingError(
        'KLING_ACCESS_KEY 或 KLING_SECRET_KEY 环境变量未设置',
        KlingErrorCode.PERMISSION_DENIED,
        403,
        false
      )
    }

    config = {
      accessKey,
      secretKey,
      baseUrl
    }
  }

  return config
}

// ============================================================
// 重试
// ============================================================

interface RetryConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
}

function calculateBackoffDelay(attempt: number, cfg: RetryConfig): number {
  const delay = cfg.initialDelayMs * Math.pow(cfg.backoffMultiplier, attempt)
  const jitter = delay * 0.2 * (Math.random() - 0.5)
  return Math.min(delay + jitter, cfg.maxDelayMs)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseError(error: unknown): KlingError {
  if (error instanceof KlingError) {
    return error
  }

  const err = error as { status?: number, message?: string }
  const status = err.status || 500
  const message = err.message || '未知错误'

  let code: KlingErrorCode
  switch (status) {
    case 400:
      code = KlingErrorCode.INVALID_ARGUMENT
      break
    case 401:
      code = KlingErrorCode.PERMISSION_DENIED
      break
    case 403:
      code = KlingErrorCode.PERMISSION_DENIED
      break
    case 404:
      code = KlingErrorCode.NOT_FOUND
      break
    case 429:
      code = KlingErrorCode.RESOURCE_EXHAUSTED
      break
    case 500:
      code = KlingErrorCode.INTERNAL
      break
    case 503:
      code = KlingErrorCode.UNAVAILABLE
      break
    case 504:
      code = KlingErrorCode.DEADLINE_EXCEEDED
      break
    default:
      code = KlingErrorCode.UNKNOWN
  }

  return new KlingError(message, code, status, RETRYABLE_ERROR_CODES.has(code))
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retryConfig: Partial<RetryConfig> = {}
): Promise<T> {
  const filteredConfig = Object.fromEntries(
    Object.entries(retryConfig).filter(([, value]) => value !== undefined)
  )
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...filteredConfig }
  let lastError: KlingError = new KlingError('未知错误', KlingErrorCode.UNKNOWN, 500, false)

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = parseError(error)
      console.warn(`[Kling] 请求失败 (attempt ${attempt + 1}/${cfg.maxRetries + 1}):`, lastError.message)
      if (!lastError.retryable || attempt === cfg.maxRetries) {
        throw lastError
      }
      const delay = calculateBackoffDelay(attempt, cfg)
      await sleep(delay)
    }
  }

  throw lastError
}

// ============================================================
// JWT 鉴权
// ============================================================

function base64UrlEncode(input: string | Buffer): string {
  const base64 = Buffer.isBuffer(input)
    ? input.toString('base64')
    : Buffer.from(input).toString('base64')
  return base64
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function buildJwtToken(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  }
  const payload = {
    iss: accessKey,
    exp: now + JWT_TTL_SECONDS,
    nbf: now - 5
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = createHmac('sha256', secretKey).update(signingInput).digest()
  const encodedSignature = base64UrlEncode(signature)

  return `${signingInput}.${encodedSignature}`
}

function stripDataUrlPrefix(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('data:')) return trimmed
  const commaIndex = trimmed.indexOf(',')
  if (commaIndex < 0) return trimmed
  return trimmed.slice(commaIndex + 1)
}

function normalizeImageInput(image?: string): string | undefined {
  if (!image) return undefined
  const trimmed = image.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return stripDataUrlPrefix(trimmed)
}

function normalizeDuration(duration?: number): string {
  const fallback = 5
  const numeric = typeof duration === 'number' && Number.isFinite(duration) ? duration : fallback
  const clamped = Math.min(15, Math.max(3, Math.round(numeric)))
  return String(clamped)
}

// ============================================================
// HTTP 请求
// ============================================================

interface KlingEnvelope<T> {
  code: number
  message: string
  request_id?: string
  data: T
}

async function request<T>(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: Record<string, unknown>,
  options: { timeout?: number } = {}
): Promise<KlingEnvelope<T>> {
  const cfg = getConfig()
  const token = buildJwtToken(cfg.accessKey, cfg.secretKey)
  const url = `${cfg.baseUrl}${endpoint}`

  const controller = new AbortController()
  const timeoutId = options.timeout
    ? setTimeout(() => controller.abort(), options.timeout)
    : null

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: method === 'POST' && body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })

    const parsed = await response.json().catch(() => ({})) as KlingEnvelope<T> & {
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new KlingError(
        parsed.message || parsed.error?.message || `HTTP ${response.status}`,
        KlingErrorCode.UNKNOWN,
        response.status,
        response.status >= 500 || response.status === 429
      )
    }

    if (typeof parsed.code === 'number' && parsed.code !== 0) {
      const status = parsed.code >= 5000 ? 500 : 400
      throw new KlingError(
        parsed.message || `Kling API 错误码 ${parsed.code}`,
        status >= 500 ? KlingErrorCode.INTERNAL : KlingErrorCode.INVALID_ARGUMENT,
        status,
        false
      )
    }

    return parsed
  } catch (error) {
    if (error instanceof KlingError) throw error

    if (error instanceof Error && error.name === 'AbortError') {
      throw new KlingError(
        '请求超时',
        KlingErrorCode.DEADLINE_EXCEEDED,
        504,
        true
      )
    }

    throw parseError(error)
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

// ============================================================
// 视频生成
// ============================================================

interface KlingCreateTaskData {
  task_id: string
  task_status: 'submitted' | 'processing' | 'succeed' | 'failed'
}

interface KlingTaskVideo {
  id: string
  url: string
  watermark_url?: string
  duration?: string
}

interface KlingTaskQueryData {
  task_id: string
  task_status: 'submitted' | 'processing' | 'succeed' | 'failed'
  task_status_msg?: string
  task_result?: {
    videos?: KlingTaskVideo[]
  }
}

export async function _klingGenerateVideo(options: {
  model?: string
  prompt: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  duration?: number
  aspectRatio?: string
  withAudio?: boolean
  mode?: 'std' | 'pro'
  negativePrompt?: string
  maxRetries?: number
}): Promise<{ videoUrl: string, taskId: string }> {
  const model = options.model || KlingVideoModels.KLING_V2_6
  const mode = options.mode || 'pro'
  const sound = options.withAudio ? 'on' : 'off'
  const duration = normalizeDuration(options.duration)
  const aspectRatio = options.aspectRatio || '16:9'

  const image = normalizeImageInput(options.imageUrl || options.firstFrameUrl)
  const imageTail = normalizeImageInput(options.lastFrameUrl)
  const hasImageInput = !!image || !!imageTail

  const endpoint = hasImageInput ? '/v1/videos/image2video' : '/v1/videos/text2video'
  const body: Record<string, unknown> = {
    model_name: model,
    prompt: options.prompt,
    duration,
    mode,
    sound,
    aspect_ratio: aspectRatio
  }

  if (options.negativePrompt) {
    body.negative_prompt = options.negativePrompt
  }

  if (hasImageInput) {
    if (image) body.image = image
    if (imageTail) body.image_tail = imageTail
    delete body.aspect_ratio
  }

  const submit = await withRetry(
    () => request<KlingCreateTaskData>('POST', endpoint, body, { timeout: 30000 }),
    { maxRetries: options.maxRetries }
  )

  const taskId = submit.data?.task_id
  if (!taskId) {
    throw new KlingError('创建任务成功但未返回 task_id', KlingErrorCode.INTERNAL, 500, false)
  }

  const maxWaitTime = 12 * 60 * 1000
  const pollInterval = 10000
  const startedAt = Date.now()
  const queryEndpoint = `${endpoint}/${taskId}`

  while (Date.now() - startedAt < maxWaitTime) {
    await sleep(pollInterval)
    const statusResponse = await withRetry(
      () => request<KlingTaskQueryData>('GET', queryEndpoint, undefined, { timeout: 30000 }),
      { maxRetries: 2 }
    )

    const status = statusResponse.data?.task_status
    if (status === 'succeed') {
      const videoUrl = statusResponse.data?.task_result?.videos?.[0]?.url
      if (!videoUrl) {
        throw new KlingError('任务成功但未返回视频 URL', KlingErrorCode.INTERNAL, 500, false)
      }
      return { videoUrl, taskId }
    }

    if (status === 'failed') {
      throw new KlingError(
        statusResponse.data?.task_status_msg || statusResponse.message || '视频生成失败',
        KlingErrorCode.INTERNAL,
        500,
        false
      )
    }
  }

  throw new KlingError('视频生成超时', KlingErrorCode.DEADLINE_EXCEEDED, 504, false)
}
