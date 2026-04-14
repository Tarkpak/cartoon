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
  KLING_VIDEO_O1: 'kling-video-o1',
  KLING_V3_OMNI: 'kling-v3-omni',
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

export const KlingImageModels = {
  KLING_IMAGE_O1: 'kling-image-o1',
  KLING_V3_OMNI: 'kling-v3-omni',
  KLING_V1: 'kling-v1',
  KLING_V1_5: 'kling-v1-5',
  KLING_V2: 'kling-v2',
  KLING_V2_NEW: 'kling-v2-new',
  KLING_V2_1: 'kling-v2-1',
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

function sanitizeKlingLogValue(
  value: unknown,
  keyHint: string = '',
  depth: number = 0
): unknown {
  if (depth > 4) return '[depth-limited]'

  if (typeof value === 'string') {
    const trimmed = value.trim()
    const key = keyHint.toLowerCase()
    const isMediaField = key.includes('image') || key.includes('video') || key.includes('audio')
    const isHttpUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://')
    const isDataUri = trimmed.startsWith('data:')
    const looksLikeBase64 = /^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 256

    if (isDataUri) return `[data-uri len=${trimmed.length}]`
    if (looksLikeBase64) return `[base64 len=${trimmed.length}]`

    if (isMediaField && isHttpUrl && trimmed.length > 140) {
      return `${trimmed.slice(0, 140)}... (len=${trimmed.length})`
    }

    if (trimmed.length > 600) {
      return `${trimmed.slice(0, 220)}... (len=${trimmed.length})`
    }

    return trimmed
  }

  if (Array.isArray(value)) {
    const maxItems = 4
    const preview = value
      .slice(0, maxItems)
      .map(item => sanitizeKlingLogValue(item, keyHint, depth + 1))
    if (value.length > maxItems) {
      preview.push(`[+${value.length - maxItems} items]`)
    }
    return preview
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sanitizeKlingLogValue(item, key, depth + 1)
    }
    return output
  }

  return value
}

function sanitizeKlingLogPayload(payload?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!payload) return undefined
  return sanitizeKlingLogValue(payload) as Record<string, unknown>
}

function normalizeDuration(duration?: number, maxDuration: number = 15): string {
  const fallback = 5
  const numeric = typeof duration === 'number' && Number.isFinite(duration) ? duration : fallback
  const clamped = Math.min(maxDuration, Math.max(3, Math.round(numeric)))
  return String(clamped)
}

const SUPPORTED_IMAGE_ASPECT_RATIOS = [
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '21:9'
] as const

type KlingImageAspectRatio = (typeof SUPPORTED_IMAGE_ASPECT_RATIOS)[number]
type KlingOmniImageAspectRatio = KlingImageAspectRatio | 'auto'

const KLING_OMNI_IMAGE_MODELS = new Set<string>([
  KlingImageModels.KLING_IMAGE_O1,
  KlingImageModels.KLING_V3_OMNI
])

const KLING_MULTI_IMAGE_MODELS = new Set<string>([
  KlingImageModels.KLING_V2,
  KlingImageModels.KLING_V2_1
])

const KLING_OMNI_VIDEO_MODELS = new Set<string>([
  KlingVideoModels.KLING_VIDEO_O1,
  KlingVideoModels.KLING_V3_OMNI
])

const IMAGE_ASPECT_RATIO_VALUES: Array<{ ratio: KlingImageAspectRatio, value: number }> = SUPPORTED_IMAGE_ASPECT_RATIOS.map((ratio) => {
  const [w = 1, h = 1] = ratio.split(':').map(v => Number(v) || 1)
  return {
    ratio,
    value: w / h
  }
})

function normalizeImageCount(n?: number): number {
  const fallback = 1
  const numeric = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.min(9, Math.max(1, Math.round(numeric)))
}

function parseSizeRatio(size?: string): number | null {
  if (!size) return null
  const matched = size.trim().replace(/\*/g, 'x').match(/^(\d+)\s*x\s*(\d+)$/i)
  if (!matched) return null
  const width = Number(matched[1])
  const height = Number(matched[2])
  if (!width || !height) return null
  return width / height
}

function normalizeAspectRatioInput(aspectRatio?: string): KlingImageAspectRatio | null {
  if (!aspectRatio) return null
  const normalized = aspectRatio.trim() as KlingImageAspectRatio
  return SUPPORTED_IMAGE_ASPECT_RATIOS.includes(normalized) ? normalized : null
}

function resolveImageAspectRatio(options: { aspectRatio?: string, size?: string }): KlingImageAspectRatio {
  const explicitRatio = normalizeAspectRatioInput(options.aspectRatio)
  if (explicitRatio) {
    return explicitRatio
  }

  const ratioFromSize = parseSizeRatio(options.size)
  if (!ratioFromSize) {
    return '1:1'
  }

  let best = IMAGE_ASPECT_RATIO_VALUES[0]!
  for (const candidate of IMAGE_ASPECT_RATIO_VALUES) {
    if (Math.abs(candidate.value - ratioFromSize) < Math.abs(best.value - ratioFromSize)) {
      best = candidate
    }
  }
  return best.ratio
}

function resolveOmniImageAspectRatio(options: { aspectRatio?: string, size?: string }): KlingOmniImageAspectRatio {
  const explicitRatio = normalizeAspectRatioInput(options.aspectRatio)
  if (explicitRatio) {
    return explicitRatio
  }

  const ratioFromSize = parseSizeRatio(options.size)
  if (!ratioFromSize) {
    return 'auto'
  }

  let best = IMAGE_ASPECT_RATIO_VALUES[0]!
  for (const candidate of IMAGE_ASPECT_RATIO_VALUES) {
    if (Math.abs(candidate.value - ratioFromSize) < Math.abs(best.value - ratioFromSize)) {
      best = candidate
    }
  }
  return best.ratio
}

function resolveOmniImageResolution(size?: string, model?: string): '1k' | '2k' | '4k' {
  const normalized = (size || '').trim().toLowerCase()
  let resolution: '1k' | '2k' | '4k' = '1k'

  if (normalized.includes('4k')) {
    resolution = '4k'
  } else if (normalized.includes('2k')) {
    resolution = '2k'
  } else if (normalized) {
    const matched = normalized.replace(/\*/g, 'x').match(/^(\d+)\s*x\s*(\d+)$/i)
    if (matched) {
      const width = Number(matched[1]) || 0
      const height = Number(matched[2]) || 0
      const maxEdge = Math.max(width, height)
      if (maxEdge >= 3000) {
        resolution = '4k'
      } else if (maxEdge >= 1800) {
        resolution = '2k'
      }
    }
  }

  // kling-image-o1 当前仅支持 1k/2k
  if (model === KlingImageModels.KLING_IMAGE_O1 && resolution === '4k') {
    resolution = '2k'
  }

  return resolution
}

function isOmniImageModel(model: string): boolean {
  return KLING_OMNI_IMAGE_MODELS.has(model)
}

function isOmniVideoModel(model: string): boolean {
  return KLING_OMNI_VIDEO_MODELS.has(model)
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

  if (method === 'POST') {
    console.log('[Kling] HTTP 请求参数:', {
      method,
      endpoint,
      body: sanitizeKlingLogPayload(body)
    })
  }

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

interface KlingTaskImage {
  id?: string
  url: string
  index?: number
}

interface KlingImageTaskQueryData {
  task_id: string
  task_status: 'submitted' | 'processing' | 'succeed' | 'failed'
  task_status_msg?: string
  task_result?: {
    images?: KlingTaskImage[]
    series_images?: KlingTaskImage[]
  }
}

export async function _klingGenerateImage(options: {
  model?: string
  prompt: string
  negativePrompt?: string
  size?: string
  aspectRatio?: string
  n?: number
  referenceImages?: string[]
  maxRetries?: number
}): Promise<{ imageUrl: string, taskId: string }> {
  const model = options.model || KlingImageModels.KLING_V2
  const n = normalizeImageCount(options.n)
  const normalizedReferenceImages = Array.from(new Set(
    (options.referenceImages || [])
      .map(item => normalizeImageInput(item))
      .filter((item): item is string => !!item)
  ))
  const referenceImage = normalizedReferenceImages[0]
  const useOmniImageEndpoint = isOmniImageModel(model)
  const hasMultipleReferenceImages = normalizedReferenceImages.length > 1
  const useMultiImageEndpoint = !useOmniImageEndpoint && hasMultipleReferenceImages && KLING_MULTI_IMAGE_MODELS.has(model)
  const aspectRatio = useOmniImageEndpoint
    ? resolveOmniImageAspectRatio({ aspectRatio: options.aspectRatio, size: options.size })
    : resolveImageAspectRatio({ aspectRatio: options.aspectRatio, size: options.size })

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Kling] generateImage 请求参数:`, {
    model,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    negativePrompt: options.negativePrompt,
    aspectRatio,
    n,
    referenceImagesCount: normalizedReferenceImages.length,
    useOmniImageEndpoint,
    useMultiImageEndpoint,
    maxRetries: options.maxRetries
  })

  let endpoint = '/v1/images/generations'
  let body: Record<string, unknown>
  if (useOmniImageEndpoint) {
    endpoint = '/v1/images/omni-image'
    body = {
      model_name: model,
      prompt: options.prompt,
      resolution: resolveOmniImageResolution(options.size, model),
      aspect_ratio: aspectRatio,
      result_type: 'single',
      n
    }

    if (normalizedReferenceImages.length > 0) {
      body.image_list = normalizedReferenceImages.slice(0, 9).map(image => ({ image }))
    }

    if (options.negativePrompt) {
      console.warn('[Kling] omni-image 不支持 negative_prompt 字段，已忽略该参数')
    }
  } else if (useMultiImageEndpoint) {
    endpoint = '/v1/images/multi-image2image'
    body = {
      model_name: model,
      prompt: options.prompt,
      aspect_ratio: aspectRatio,
      n,
      subject_image_list: normalizedReferenceImages.slice(0, 4).map(subjectImage => ({
        subject_image: subjectImage
      }))
    }
    if (options.negativePrompt) {
      console.warn('[Kling] multi-image2image 不支持 negative_prompt，已忽略该参数')
    }
  } else {
    if (hasMultipleReferenceImages && !KLING_MULTI_IMAGE_MODELS.has(model)) {
      console.warn(`[Kling] 模型 ${model} 暂不支持 multi-image2image，已自动回退单参考图模式`)
    }

    body = {
      model_name: model,
      prompt: options.prompt,
      aspect_ratio: aspectRatio,
      n
    }

    if (referenceImage) {
      body.image = referenceImage
    }

    // 可灵图生图模式下不支持 negative_prompt，避免发送无效参数
    if (options.negativePrompt && !referenceImage) {
      body.negative_prompt = options.negativePrompt
    }

    // kling-v1-5 图生图常用的参考图控制参数
    if (referenceImage && model === KlingImageModels.KLING_V1_5) {
      body.image_reference = 'subject'
      body.image_fidelity = 0.5
      body.human_fidelity = 0.45
    }
  }

  const submit = await withRetry(
    () => request<KlingCreateTaskData>('POST', endpoint, body, { timeout: 30000 }),
    { maxRetries: options.maxRetries }
  )

  const taskId = submit.data?.task_id
  if (!taskId) {
    throw new KlingError('创建图片任务成功但未返回 task_id', KlingErrorCode.INTERNAL, 500, false)
  }

  const maxWaitTime = 5 * 60 * 1000
  const pollInterval = 5000
  const startedAt = Date.now()
  const queryEndpoint = `${endpoint}/${taskId}`

  while (Date.now() - startedAt < maxWaitTime) {
    await sleep(pollInterval)
    const statusResponse = await withRetry(
      () => request<KlingImageTaskQueryData>('GET', queryEndpoint, undefined, { timeout: 30000 }),
      { maxRetries: 2 }
    )

    const status = statusResponse.data?.task_status
    if (status === 'succeed') {
      const imageUrl = statusResponse.data?.task_result?.images?.[0]?.url
        || statusResponse.data?.task_result?.series_images?.[0]?.url
      if (!imageUrl) {
        throw new KlingError('图片任务成功但未返回 URL', KlingErrorCode.INTERNAL, 500, false)
      }
      console.log(`[Kling] 图片生成成功: ${imageUrl.slice(0, 100)}...`)
      return { imageUrl, taskId }
    }

    if (status === 'failed') {
      throw new KlingError(
        statusResponse.data?.task_status_msg || statusResponse.message || '图片生成失败',
        KlingErrorCode.INTERNAL,
        500,
        false
      )
    }
  }

  throw new KlingError('图片生成超时', KlingErrorCode.DEADLINE_EXCEEDED, 504, false)
}

export async function _klingGenerateVideo(options: {
  model?: string
  prompt: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImages?: string[]
  duration?: number
  aspectRatio?: string
  withAudio?: boolean
  mode?: 'std' | 'pro'
  negativePrompt?: string
  maxRetries?: number
}): Promise<{ videoUrl: string, taskId: string }> {
  const model = options.model || KlingVideoModels.KLING_V2_6
  const useOmniVideoEndpoint = isOmniVideoModel(model)
  const mode = options.mode || 'pro'
  const sound = options.withAudio ? 'on' : 'off'
  const duration = normalizeDuration(
    options.duration,
    model === KlingVideoModels.KLING_VIDEO_O1 ? 10 : 15
  )
  const aspectRatio = options.aspectRatio || '16:9'

  let image = normalizeImageInput(options.imageUrl || options.firstFrameUrl)
  const imageTail = normalizeImageInput(options.lastFrameUrl)
  const normalizedReferenceImages = Array.from(new Set(
    (options.referenceImages || [])
      .map(item => normalizeImageInput(item))
      .filter((item): item is string => !!item)
  ))
  let hasImageInput = !!image || !!imageTail

  if (!useOmniVideoEndpoint && !hasImageInput && normalizedReferenceImages.length > 0) {
    image = normalizedReferenceImages[0]
    hasImageInput = true
    console.warn('[Kling] image2video/text2video 不支持多参考图，已使用 referenceImages[0] 作为 image 输入')
  } else if (!useOmniVideoEndpoint && normalizedReferenceImages.length > 0) {
    console.warn('[Kling] 当前模型不支持多参考图，referenceImages 已忽略（仅保留 image/首尾帧）')
  }

  const endpoint = useOmniVideoEndpoint
    ? '/v1/videos/omni-video'
    : hasImageInput
      ? '/v1/videos/image2video'
      : '/v1/videos/text2video'
  const body: Record<string, unknown> = {
    model_name: model,
    prompt: options.prompt,
    duration,
    mode,
    sound
  }

  if (options.negativePrompt && !useOmniVideoEndpoint) {
    body.negative_prompt = options.negativePrompt
  } else if (options.negativePrompt && useOmniVideoEndpoint) {
    console.warn('[Kling] omni-video 不支持 negative_prompt 字段，已忽略该参数')
  }

  if (useOmniVideoEndpoint) {
    const imageList: Array<{ image_url: string, type?: 'first_frame' | 'end_frame' }> = []

    if (image && imageTail) {
      imageList.push(
        { image_url: image, type: 'first_frame' },
        { image_url: imageTail, type: 'end_frame' }
      )
    } else if (image) {
      imageList.push({ image_url: image })
    } else if (imageTail) {
      console.warn('[Kling] omni-video 不支持仅尾帧输入，已自动忽略尾帧参数')
    }

    const existingUrls = new Set(imageList.map(item => item.image_url))
    for (const refImage of normalizedReferenceImages) {
      if (existingUrls.has(refImage)) continue
      imageList.push({ image_url: refImage })
      existingUrls.add(refImage)
    }

    if (model === KlingVideoModels.KLING_VIDEO_O1 && image && imageTail && imageList.length > 2) {
      console.warn('[Kling] kling-video-o1 在首尾帧模式下不支持 >2 张参考图，已忽略额外 referenceImages')
      body.image_list = imageList.slice(0, 2)
    } else if (imageList.length > 0) {
      body.image_list = imageList.slice(0, 9)
    }

    if (!hasImageInput || image) {
      body.aspect_ratio = aspectRatio
    }
  } else {
    body.aspect_ratio = aspectRatio
    if (hasImageInput) {
      if (image) body.image = image
      if (imageTail) body.image_tail = imageTail
      delete body.aspect_ratio
    }
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
