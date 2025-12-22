import { GoogleGenAI } from '@google/genai'

let client: GoogleGenAI | null = null

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

// ============================================================
// 客户端初始化
// ============================================================

/**
 * 获取 Gemini API 客户端实例 (单例模式)
 */
export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    const config = useRuntimeConfig()
    const apiKey = config.geminiApiKey as string

    if (!apiKey) {
      throw new GeminiError(
        'GEMINI_API_KEY 环境变量未设置',
        GeminiErrorCode.PERMISSION_DENIED,
        403,
        false
      )
    }

    client = new GoogleGenAI({ apiKey })
  }

  return client
}

// ============================================================
// 模型配置
// ============================================================

/**
 * 文本生成模型配置
 */
export const TextModels = {
  /** 剧本解析 - 使用 gemini-2.5-flash (gemini-3-pro-preview 无免费层级) */
  SCRIPT_PARSER: 'gemini-3-flash-preview',
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
  FAST: 'gemini-2.5-flash-image'
} as const

/**
 * 视频生成模型配置
 */
export const VideoModels = {
  /** Veo 3.1 - 支持首尾帧 */
  VEO_3_1: 'veo-3.1-generate-preview',
  /** Veo 3.1 快速版 - 速度优化 */
  VEO_3_1_FAST: 'veo-3.1-fast-generate-preview'
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

export interface RetryConfig {
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

/**
 * 带重试的 API 调用
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config }
  let lastError: GeminiError | null = null

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = parseError(error)

      // 如果不可重试或已达到最大重试次数，抛出错误
      if (!lastError.retryable || attempt === retryConfig.maxRetries) {
        throw lastError
      }

      // 计算并等待退避时间
      const delay = calculateBackoffDelay(attempt, retryConfig)
      console.warn(
        `[Gemini] 请求失败 (${lastError.code}), `
        + `${delay.toFixed(0)}ms 后重试 (${attempt + 1}/${retryConfig.maxRetries})...`
      )
      await sleep(delay)
    }
  }

  throw lastError
}

/**
 * 生成文本内容
 */
export async function generateText(options: {
  model?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<string> {
  const client = getGeminiClient()
  const model = options.model || TextModels.GENERAL

  console.log('[Gemini] generateText 请求参数:', {
    model,
    promptLength: options.prompt.length,
    promptPreview: options.prompt.slice(0, 200) + (options.prompt.length > 200 ? '...' : ''),
    systemInstruction: options.systemInstruction ? options.systemInstruction.slice(0, 100) + '...' : undefined,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })

  return withRetry(async () => {
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
 */
export async function generateJSON<T>(options: {
  model?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<T> {
  const client = getGeminiClient()
  const model = options.model || TextModels.GENERAL

  console.log('[Gemini] generateJSON 请求参数:', {
    model,
    promptLength: options.prompt.length,
    // promptPreview: options.prompt.slice(0, 200) + (options.prompt.length > 200 ? '...' : ''),
    // systemInstruction: options.systemInstruction ? options.systemInstruction.slice(0, 100) + '...' : undefined,

    promptPreview: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature ?? 0.2,
    maxRetries: options.maxRetries
  })

  return withRetry(async () => {
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
 */
export async function generateImage(options: {
  model?: string
  prompt: string
  referenceImage?: { data: string, mimeType: string }
  maxRetries?: number
}): Promise<{ imageData: string, mimeType: string, text?: string }> {
  const client = getGeminiClient()
  const model = options.model || ImageModels.HIGH_QUALITY

  console.log('[Gemini] generateImage 请求参数:', {
    model,
    promptLength: options.prompt.length,
    promptPreview: options.prompt.slice(0, 200) + (options.prompt.length > 200 ? '...' : ''),
    hasReferenceImage: !!options.referenceImage,
    referenceImageMimeType: options.referenceImage?.mimeType,
    maxRetries: options.maxRetries
  })

  return withRetry(async () => {
    // 构建请求内容
    const parts: Array<{ text: string } | { inlineData: { data: string, mimeType: string } }> = [
      { text: options.prompt }
    ]

    // 如果有参考图片，添加到请求中
    if (options.referenceImage) {
      parts.push({
        inlineData: {
          data: options.referenceImage.data,
          mimeType: options.referenceImage.mimeType
        }
      })
    }

    const response = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['image', 'text']
      }
    })

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
