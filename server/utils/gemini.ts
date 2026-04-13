import { GoogleGenAI } from '@google/genai'

// ============================================================
// 错误类型定义
// ============================================================

/**
 * Gemini API 错误码
 */
export enum GeminiErrorCode {
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NOT_FOUND = 'NOT_FOUND',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',
  INTERNAL = 'INTERNAL',
  UNAVAILABLE = 'UNAVAILABLE',
  DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED',
  UNKNOWN = 'UNKNOWN'
}

/**
 * Gemini API 错误
 */
export class GeminiError extends Error {
  constructor(
    message: string,
    public code: GeminiErrorCode,
    public status?: number,
    public retryable: boolean = false
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

/**
 * 可重试的错误码
 */
const RETRYABLE_ERROR_CODES = new Set([
  GeminiErrorCode.RESOURCE_EXHAUSTED, // 429 - 速率限制
  GeminiErrorCode.INTERNAL, // 500 - 内部错误
  GeminiErrorCode.UNAVAILABLE, // 503 - 服务不可用
  GeminiErrorCode.DEADLINE_EXCEEDED // 504 - 超时
])

const KEY_AUTH_ERROR_PATTERNS = [
  /api[_\s-]?key/i,
  /invalid.*key/i,
  /unauthorized/i,
  /permission denied/i,
  /unregistered callers/i,
  /credential/i
]

interface GeminiClientEntry {
  apiKey: string
  client: GoogleGenAI
  disabledUntil: number
  disabledPermanently: boolean
}

interface GeminiClientSelection {
  index: number
  keyAlias: string
  client: GoogleGenAI
}

let clientPool: GeminiClientEntry[] = []
let clientPoolRawKey = ''
let clientRoundRobinIndex = 0

// ============================================================
// 客户端初始化
// ============================================================

function splitGeminiApiKeys(rawApiKey: string): string[] {
  return Array.from(
    new Set(
      rawApiKey
        .split(/[\n,;]+/)
        .map(key => key.trim())
        .filter(Boolean)
    )
  )
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 10) {
    return `${apiKey.slice(0, 2)}***`
  }
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
}

function isCredentialError(error: GeminiError): boolean {
  const message = error.message || ''
  if (error.status === 401 || error.status === 403) {
    return true
  }
  if (error.status === 400) {
    return KEY_AUTH_ERROR_PATTERNS.some(pattern => pattern.test(message))
  }
  return false
}

function ensureClientPool(): GeminiClientEntry[] {
  const config = useRuntimeConfig()
  const rawApiKey = String(config.geminiApiKey || '').trim()

  if (!rawApiKey) {
    throw new GeminiError(
      'GEMINI_API_KEY 环境变量未设置',
      GeminiErrorCode.PERMISSION_DENIED,
      403,
      false
    )
  }

  if (clientPool.length > 0 && clientPoolRawKey === rawApiKey) {
    return clientPool
  }

  const apiKeys = splitGeminiApiKeys(rawApiKey)

  if (apiKeys.length === 0) {
    throw new GeminiError(
      'GEMINI_API_KEY 环境变量为空',
      GeminiErrorCode.PERMISSION_DENIED,
      403,
      false
    )
  }

  clientPool = apiKeys.map(apiKey => ({
    apiKey,
    client: new GoogleGenAI({ apiKey }),
    disabledUntil: 0,
    disabledPermanently: false
  }))
  clientPoolRawKey = rawApiKey
  clientRoundRobinIndex = 0

  const keyAliases = clientPool.map(entry => maskApiKey(entry.apiKey))
  console.log(`[Gemini] 已初始化 API Key 池，共 ${clientPool.length} 个: ${keyAliases.join(', ')}`)

  return clientPool
}

function getNextGeminiClientSelection(): GeminiClientSelection {
  const pool = ensureClientPool()
  const now = Date.now()
  const poolLength = pool.length

  let earliestCooldown: { index: number, disabledUntil: number } | null = null

  for (let offset = 0; offset < poolLength; offset++) {
    const index = (clientRoundRobinIndex + offset) % poolLength
    const entry = pool[index]
    if (!entry || entry.disabledPermanently) {
      continue
    }

    if (entry.disabledUntil > now) {
      if (!earliestCooldown || entry.disabledUntil < earliestCooldown.disabledUntil) {
        earliestCooldown = { index, disabledUntil: entry.disabledUntil }
      }
      continue
    }

    clientRoundRobinIndex = (index + 1) % poolLength
    return {
      index,
      keyAlias: maskApiKey(entry.apiKey),
      client: entry.client
    }
  }

  if (earliestCooldown) {
    const waitSeconds = Math.max(1, Math.ceil((earliestCooldown.disabledUntil - now) / 1000))
    throw new GeminiError(
      `所有 Gemini API Key 正在冷却中，请约 ${waitSeconds}s 后重试`,
      GeminiErrorCode.RESOURCE_EXHAUSTED,
      429,
      true
    )
  }

  throw new GeminiError(
    '所有 Gemini API Key 均不可用，请检查配置',
    GeminiErrorCode.PERMISSION_DENIED,
    403,
    false
  )
}

function markClientSuccess(selection: GeminiClientSelection): void {
  const entry = clientPool[selection.index]
  if (!entry || entry.disabledPermanently) return
  entry.disabledUntil = 0
}

function markClientFailure(
  selection: GeminiClientSelection,
  error: GeminiError,
  cooldownMs: number
): void {
  const entry = clientPool[selection.index]
  if (!entry) return

  if (isCredentialError(error)) {
    entry.disabledPermanently = true
    entry.disabledUntil = Number.POSITIVE_INFINITY
    console.warn(`[Gemini] API Key ${selection.keyAlias} 认证失败，已永久禁用`)
    return
  }

  if (cooldownMs > 0) {
    const nextUntil = Date.now() + cooldownMs
    entry.disabledUntil = Math.max(entry.disabledUntil, nextUntil)
    console.warn(`[Gemini] API Key ${selection.keyAlias} 暂时冷却 ${Math.ceil(cooldownMs / 1000)}s`)
  }
}

function hasAlternativeReadyClient(currentIndex: number): boolean {
  const now = Date.now()
  return ensureClientPool().some((entry, index) =>
    index !== currentIndex
    && !entry.disabledPermanently
    && entry.disabledUntil <= now
  )
}

/**
 * 获取 Gemini API 客户端实例（轮询模式）
 */
export function getGeminiClient(): GoogleGenAI {
  return getNextGeminiClientSelection().client
}

// ============================================================
// 模型配置
// ============================================================

/**
 * 文本生成模型配置
 */
export const TextModels = {
  /** 剧本解析 */
  SCRIPT_PARSER: 'gemini-3.1-pro-preview',
  /** 通用任务 */
  GENERAL: 'gemini-3-flash-preview'
} as const

/**
 * 图片生成模型配置
 */
export const ImageModels = {
  /** Nano Banana Pro - 4K高质量 */
  HIGH_QUALITY: 'gemini-3-pro-image-preview',
  /** Nano Banana - 快速生成 */
  FAST: 'gemini-3.1-flash-image-preview'
} as const

/**
 * 视频生成模型配置
 */
export const VideoModels = {
  /** Veo 3.1 - 支持首尾帧 */
  VEO_3_1: 'veo-3.1-generate-preview',
  /** Veo 3.1 Fast - 速度优化（支持 referenceImages） */
  VEO_3_1_FAST: 'veo-3.1-fast-generate-preview',
  /** Veo 3.1 Lite - 轻量版（不支持 referenceImages） */
  VEO_3_1_LITE: 'veo-3.1-lite-generate-preview'
} as const

/**
 * 音频生成模型配置
 */
export const AudioModels = {
  /** Lyria - 背景音乐 */
  LYRIA: 'lyria-realtime-exp'
} as const

// ============================================================
// 重试配置
// ============================================================

/** @internal */
interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number
  /** 初始延迟 (毫秒) */
  initialDelayMs: number
  /** 最大延迟 (毫秒) */
  maxDelayMs: number
  /** 退避乘数 */
  backoffMultiplier: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 32000,
  backoffMultiplier: 2
}

/**
 * 计算指数退避延迟
 */
function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt)
  // 添加 ±20% 的抖动以避免雷鸣羊群效应
  const jitter = delay * 0.2 * (Math.random() - 0.5)
  return Math.min(delay + jitter, config.maxDelayMs)
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 解析错误为 GeminiError
 */
function parseError(error: unknown): GeminiError {
  if (error instanceof GeminiError) {
    return error
  }

  const err = error as { status?: number, message?: string, code?: string }
  const status = err.status || 500
  const message = err.message || '未知错误'

  let code: GeminiErrorCode
  switch (status) {
    case 400:
      code = GeminiErrorCode.INVALID_ARGUMENT
      break
    case 401:
      code = GeminiErrorCode.PERMISSION_DENIED
      break
    case 403:
      code = GeminiErrorCode.PERMISSION_DENIED
      break
    case 404:
      code = GeminiErrorCode.NOT_FOUND
      break
    case 429:
      code = GeminiErrorCode.RESOURCE_EXHAUSTED
      break
    case 500:
      code = GeminiErrorCode.INTERNAL
      break
    case 503:
      code = GeminiErrorCode.UNAVAILABLE
      break
    case 504:
      code = GeminiErrorCode.DEADLINE_EXCEEDED
      break
    default:
      code = GeminiErrorCode.UNKNOWN
  }

  return new GeminiError(
    message,
    code,
    status,
    RETRYABLE_ERROR_CODES.has(code)
  )
}

// ============================================================
// 核心 API 封装
// ============================================================

export interface GeminiRetryContext {
  client: GoogleGenAI
  keyIndex: number
  keyAlias: string
  attempt: number
  totalAttempts: number
}

/**
 * 带重试的 API 调用
 * @internal
 */
export async function _geminiWithRetry<T>(
  fn: (context: GeminiRetryContext) => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  // 过滤掉 undefined 值，避免覆盖默认配置
  const filteredConfig = Object.fromEntries(
    Object.entries(config).filter(([_, v]) => v !== undefined)
  ) as Partial<RetryConfig>

  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...filteredConfig }
  let lastError: GeminiError | null = null
  const totalAttempts = retryConfig.maxRetries + 1

  console.log(`[Gemini] _geminiWithRetry 开始, maxRetries: ${retryConfig.maxRetries}, totalAttempts: ${totalAttempts}`)

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    let selection: GeminiClientSelection
    try {
      selection = getNextGeminiClientSelection()
    } catch (selectError) {
      const parsedSelectError = parseError(selectError)
      lastError = parsedSelectError

      const hasNextAttempt = attempt < retryConfig.maxRetries
      if (!hasNextAttempt || !parsedSelectError.retryable) {
        throw parsedSelectError
      }

      const delay = calculateBackoffDelay(attempt, retryConfig)
      console.warn(
        `[Gemini] 暂无可用 API Key (${parsedSelectError.code}), `
        + `${delay.toFixed(0)}ms 后重试 (${attempt + 1}/${retryConfig.maxRetries})...`
      )
      await sleep(delay)
      continue
    }

    try {
      console.log(
        `[Gemini] _geminiWithRetry 尝试 ${attempt + 1}/${totalAttempts}, `
        + `使用 key#${selection.index + 1}(${selection.keyAlias})`
      )

      const result = await fn({
        client: selection.client,
        keyIndex: selection.index,
        keyAlias: selection.keyAlias,
        attempt,
        totalAttempts
      })

      markClientSuccess(selection)
      console.log('[Gemini] _geminiWithRetry 成功返回')
      return result
    } catch (error) {
      console.error('[Gemini] _geminiWithRetry 捕获错误:', error)
      console.error('[Gemini] 错误类型:', typeof error, '错误值:', String(error))
      lastError = parseError(error)

      const hasNextAttempt = attempt < retryConfig.maxRetries
      const shouldRetry = lastError.retryable || isCredentialError(lastError)
      const cooldownMs = lastError.retryable
        ? calculateBackoffDelay(attempt, retryConfig)
        : 0
      const retryDelayMs = lastError.retryable && !hasAlternativeReadyClient(selection.index)
        ? cooldownMs
        : 0

      if (shouldRetry) {
        markClientFailure(selection, lastError, cooldownMs)
      }

      if (!hasNextAttempt || !shouldRetry) {
        throw lastError
      }

      if (retryDelayMs > 0) {
        console.warn(
          `[Gemini] 请求失败 (${lastError.code}), `
          + `${retryDelayMs.toFixed(0)}ms 后切换 Key 重试 (${attempt + 1}/${retryConfig.maxRetries})...`
        )
        await sleep(retryDelayMs)
      } else {
        console.warn(
          `[Gemini] 请求失败 (${lastError.code}), `
          + `立即切换 Key 重试 (${attempt + 1}/${retryConfig.maxRetries})...`
        )
      }
    }
  }

  throw lastError
}

/**
 * 生成文本内容
 * @internal 仅供 model-provider.ts 使用
 */
export async function _geminiGenerateText(options: {
  model?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<string> {
  const model = options.model || TextModels.GENERAL

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Gemini] generateText 请求参数:`, {
    model,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })

  return _geminiWithRetry(async ({ client, keyAlias }) => {
    console.log(`[Gemini] generateText 使用 key: ${keyAlias}`)
    const response = await client.models.generateContent({
      model,
      contents: options.prompt,
      config: {
        systemInstruction: options.systemInstruction,
        temperature: options.temperature
      }
    })

    return response.text || ''
  }, { maxRetries: options.maxRetries })
}

/**
 * 生成 JSON 结构化输出
 * @internal 仅供 model-provider.ts 使用
 */
export async function _geminiGenerateJSON<T>(options: {
  model?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<T> {
  const model = options.model || TextModels.GENERAL

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Gemini] generateJSON 请求参数:`, {
    model,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature ?? 0.2,
    maxRetries: options.maxRetries
  })

  return _geminiWithRetry(async ({ client, keyAlias }) => {
    console.log(`[Gemini] generateJSON 使用 key: ${keyAlias}`)
    const response = await client.models.generateContent({
      model,
      contents: options.prompt,
      config: {
        systemInstruction: options.systemInstruction,
        temperature: options.temperature ?? 0.2, // JSON 生成使用较低温度
        responseMimeType: 'application/json'
      }
    })

    const text = response.text || '{}'
    return JSON.parse(text) as T
  }, { maxRetries: options.maxRetries })
}

/**
 * 生成图片
 * @internal 仅供 model-provider.ts 使用
 */
export async function _geminiGenerateImage(options: {
  model?: string
  prompt: string
  referenceImage?: { data: string, mimeType: string }
  referenceImages?: string[]
  allowTextOnlyResult?: boolean
  maxRetries?: number
}): Promise<{ imageData: string, mimeType: string, text?: string }> {
  console.log('[Gemini] _geminiGenerateImage 开始执行')

  const model = options.model || ImageModels.HIGH_QUALITY

  // 统一收集参考图：兼容单图(referenceImage)和多图(referenceImages)
  const normalizedReferences: Array<{ data: string, mimeType: string }> = []
  const seenReferenceData = new Set<string>()

  const addReference = (data: string, mimeType: string) => {
    if (!data || seenReferenceData.has(data)) return
    seenReferenceData.add(data)
    normalizedReferences.push({ data, mimeType: mimeType || 'image/png' })
  }

  if (options.referenceImage?.data) {
    addReference(options.referenceImage.data, options.referenceImage.mimeType)
  }

  if (options.referenceImages?.length) {
    for (const rawImage of options.referenceImages) {
      if (!rawImage) continue

      // 支持 data URL 和纯 base64 两种格式
      const dataUrlMatch = rawImage.match(/^data:([^;]+);base64,(.+)$/)
      if (dataUrlMatch?.[1] && dataUrlMatch[2]) {
        addReference(dataUrlMatch[2], dataUrlMatch[1])
      } else {
        addReference(rawImage, 'image/png')
      }

      // 控制上限，避免请求体过大
      if (normalizedReferences.length >= 4) break
    }
  }

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Gemini] generateImage 请求参数:`, {
    model,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    hasReferenceImage: normalizedReferences.length > 0,
    referenceImageCount: normalizedReferences.length,
    referenceImageMimeTypes: Array.from(new Set(normalizedReferences.map(img => img.mimeType))),
    referenceImageDataLengths: normalizedReferences.map(img => img.data.length).slice(0, 4),
    maxRetries: options.maxRetries
  })

  return _geminiWithRetry(async ({ client, keyAlias }) => {
    console.log(`[Gemini] _geminiWithRetry 回调函数开始执行, 使用 key: ${keyAlias}`)

    // 构建请求内容
    const parts: Array<{ text: string } | { inlineData: { data: string, mimeType: string } }> = [
      { text: options.prompt }
    ]

    // 如果有参考图片，添加到请求中
    for (const refImage of normalizedReferences) {
      parts.push({
        inlineData: {
          data: refImage.data,
          mimeType: refImage.mimeType
        }
      })
    }

    let response
    try {
      // gemini-3-pro-image-preview 需要 responseModalities 配置
      const config = model.includes('3-pro')
        ? { responseModalities: ['image', 'text'] }
        : undefined

      console.log('[Gemini] 准备调用 API, model:', model, 'config:', JSON.stringify(config))

      response = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config
      })

      console.log('[Gemini] API 调用成功, response:', !!response)
    } catch (apiError) {
      console.error('[Gemini] API 调用失败:', apiError instanceof Error ? apiError.message : String(apiError))
      console.error('[Gemini] 错误类型:', typeof apiError)
      console.error('[Gemini] 错误详情:', JSON.stringify(apiError, null, 2))
      throw apiError
    }

    console.log('[Gemini] generateImage 响应:', JSON.stringify({
      hasResponse: !!response,
      hasCandidates: !!response.candidates,
      candidatesLength: response.candidates?.length,
      firstCandidate: response.candidates?.[0]
        ? {
            hasContent: !!response.candidates[0].content,
            partsLength: response.candidates[0].content?.parts?.length
          }
        : null
    }))

    // 提取图片数据
    const responseParts = response.candidates?.[0]?.content?.parts || []
    let imageData = ''
    let mimeType = 'image/png'
    let text = ''

    for (const part of responseParts) {
      if (part.inlineData) {
        imageData = part.inlineData.data || ''
        mimeType = part.inlineData.mimeType || 'image/png'
      }
      if (part.text) {
        text = part.text
      }
    }

    if (!imageData && options.allowTextOnlyResult && text.trim()) {
      console.warn('[Gemini] 本次返回文本结果，按 allowTextOnlyResult 返回给上层处理')
      return { imageData: '', mimeType, text }
    }

    if (!imageData) {
      throw new GeminiError(
        '未能生成图片',
        GeminiErrorCode.INTERNAL,
        500,
        true
      )
    }

    return { imageData, mimeType, text }
  }, { maxRetries: options.maxRetries })
}
