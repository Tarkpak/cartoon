/**
 * 阿里云千问 (Qwen) API 封装
 * 基于阿里云百炼平台 DashScope API
 *
 * 文档参考: https://help.aliyun.com/zh/model-studio/
 */
import { withModelDebugLog } from './model-debug-log'

// ============================================================
// 错误类型定义
// ============================================================

export enum QwenErrorCode {
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NOT_FOUND = 'NOT_FOUND',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',
  INTERNAL = 'INTERNAL',
  UNAVAILABLE = 'UNAVAILABLE',
  DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED',
  UNKNOWN = 'UNKNOWN'
}

export class QwenError extends Error {
  constructor(
    message: string,
    public code: QwenErrorCode,
    public status?: number,
    public retryable: boolean = false
  ) {
    super(message)
    this.name = 'QwenError'
  }
}

const RETRYABLE_ERROR_CODES = new Set([
  QwenErrorCode.RESOURCE_EXHAUSTED,
  QwenErrorCode.INTERNAL,
  QwenErrorCode.UNAVAILABLE,
  QwenErrorCode.DEADLINE_EXCEEDED
])

// ============================================================
// 模型配置 (基于阿里云百炼平台)
// ============================================================

/** 千问文本模型 */
export const QwenTextModels = {
  // 深度思考模型
  QWEN_PLUS_THINKING: 'qwen3.6-plus',
  QWEN_FLASH_THINKING: 'qwen3.5-flash-2026-02-23',

  // 通用文本模型
  QWEN3_MAX: 'qwen3-max-2026-01-23',
  QWEN_FLASH: 'qwen-flash',
  QWEN_TURBO: 'qwen-turbo-latest',

  // DeepSeek (通过百炼平台)
  DEEPSEEK_V3_2: 'deepseek-v3.2'
} as const

/** 千问视觉理解模型 */
export const QwenVisionModels = {
  QWEN3_VL_PLUS: 'qwen3-vl-plus',
  QWEN3_VL_FLASH: 'qwen3-vl-flash'
} as const

/** 千问图片生成模型 */
export const QwenImageModels = {
  QWEN_IMAGE_2_PRO: 'qwen-image-2.0-pro',
  QWEN_IMAGE_2: 'qwen-image-2.0',
  QWEN_IMAGE_PLUS: 'qwen-image-plus',
  WAN_2_6_T2I: 'wan2.6-t2i', // 通义万相文生图
  WAN_2_6_IMAGE: 'wan2.6-image', // 通义万相图像编辑 (支持参考图)
  Z_IMAGE_TURBO: 'z-image-turbo'
} as const

/** 千问视频生成模型 (通义万相) */
export const QwenVideoModels = {
  WAN_2_6_T2V: 'wan2.6-t2v', // 文生视频
  WAN_2_6_I2V: 'wan2.6-i2v', // 图生视频
  WAN_2_2_KF2V_FLASH: 'wan2.2-kf2v-flash', // 首尾帧生视频 (推荐)
  WAN_2_1_KF2V_PLUS: 'wanx2.1-kf2v-plus' // 首尾帧生视频 (专业版)
} as const

/** 千问语音模型 */
export const QwenVoiceModels = {
  QWEN3_TTS_FLASH: 'qwen3-tts-instruct-flash',
  QWEN3_ASR_FLASH: 'qwen3-asr-flash',
  FUN_ASR_MTL: 'fun-asr-mtl'
} as const

// ============================================================
// API 配置
// ============================================================

// 北京区域 (国内)
const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
// OpenAI 兼容模式 (文本生成)
const DASHSCOPE_COMPATIBLE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

interface DashScopeConfig {
  apiKey: string
  baseUrl: string
  compatibleUrl: string
}

let config: DashScopeConfig | null = null

function getConfig(): DashScopeConfig {
  if (!config) {
    const runtimeConfig = useRuntimeConfig()
    const apiKey = runtimeConfig.qwenApiKey as string

    if (!apiKey) {
      throw new QwenError(
        'QWEN_API_KEY 环境变量未设置',
        QwenErrorCode.PERMISSION_DENIED,
        403,
        false
      )
    }

    config = {
      apiKey,
      baseUrl: DASHSCOPE_BASE_URL,
      compatibleUrl: DASHSCOPE_COMPATIBLE_URL
    }
  }
  return config
}

// ============================================================
// 重试配置
// ============================================================

/** @internal */
interface RetryConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 32000,
  backoffMultiplier: 2
}

function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt)
  const jitter = delay * 0.2 * (Math.random() - 0.5)
  return Math.min(delay + jitter, config.maxDelayMs)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseError(error: unknown): QwenError {
  if (error instanceof QwenError) {
    return error
  }

  const err = error as { status?: number, message?: string, code?: string }
  const status = err.status || 500
  const message = err.message || '未知错误'

  let code: QwenErrorCode
  switch (status) {
    case 400:
      code = QwenErrorCode.INVALID_ARGUMENT
      break
    case 403:
      code = QwenErrorCode.PERMISSION_DENIED
      break
    case 404:
      code = QwenErrorCode.NOT_FOUND
      break
    case 429:
      code = QwenErrorCode.RESOURCE_EXHAUSTED
      break
    case 500:
      code = QwenErrorCode.INTERNAL
      break
    case 503:
      code = QwenErrorCode.UNAVAILABLE
      break
    case 504:
      code = QwenErrorCode.DEADLINE_EXCEEDED
      break
    default:
      code = QwenErrorCode.UNKNOWN
  }

  return new QwenError(message, code, status, RETRYABLE_ERROR_CODES.has(code))
}

/** @internal */
async function withRetry<T>(
  fn: () => Promise<T>,
  retryConfig: Partial<RetryConfig> = {}
): Promise<T> {
  // 过滤掉 undefined 值，避免覆盖默认配置
  const filteredConfig = Object.fromEntries(
    Object.entries(retryConfig).filter(([, v]) => v !== undefined)
  )
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...filteredConfig }
  let lastError: QwenError = new QwenError('未知错误', QwenErrorCode.UNKNOWN, 500, false)

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = parseError(error)
      console.warn(`[Qwen] 请求失败 (attempt ${attempt + 1}/${cfg.maxRetries + 1}):`, lastError.message)
      if (!lastError.retryable || attempt === cfg.maxRetries) {
        throw lastError
      }
      const delay = calculateBackoffDelay(attempt, cfg)
      console.warn(`[Qwen] ${delay.toFixed(0)}ms 后重试...`)
      await sleep(delay)
    }
  }
  throw lastError
}

// ============================================================
// HTTP 请求封装
// ============================================================

async function request<T>(
  endpoint: string,
  body: Record<string, unknown>,
  options: { timeout?: number, method?: 'POST' | 'GET', useCompatible?: boolean, headers?: Record<string, string> } = {}
): Promise<T> {
  const cfg = getConfig()
  const baseUrl = options.useCompatible ? cfg.compatibleUrl : cfg.baseUrl
  const url = `${baseUrl}${endpoint}`
  const method = options.method || 'POST'

  const controller = new AbortController()
  const timeoutId = options.timeout
    ? setTimeout(() => controller.abort(), options.timeout)
    : null

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      signal: controller.signal
    }

    if (method === 'POST' && body) {
      fetchOptions.body = JSON.stringify(body)
    }

    const response = await fetch(url, fetchOptions)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { message?: string, code?: string, request_id?: string }
      console.error('[Qwen] API 错误响应:', {
        status: response.status,
        errorData,
        url,
        body: JSON.stringify(body).slice(0, 500)
      })
      throw new QwenError(
        errorData.message || `HTTP ${response.status}`,
        QwenErrorCode.UNKNOWN,
        response.status,
        response.status >= 500 || response.status === 429
      )
    }

    return await response.json() as T
  } catch (error) {
    if (error instanceof QwenError) throw error
    console.error('[Qwen] 请求异常:', error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/** 获取任务状态 (GET 请求) */
async function getTaskStatus<T>(taskId: string): Promise<T> {
  const cfg = getConfig()
  const url = `${cfg.baseUrl}/tasks/${taskId}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`
    }
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new QwenError(
      errorData.message || `HTTP ${response.status}`,
      QwenErrorCode.UNKNOWN,
      response.status,
      response.status >= 500 || response.status === 429
    )
  }

  return await response.json() as T
}

// ============================================================
// 文本生成 API (使用 OpenAI 兼容模式)
// ============================================================

interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export async function _qwenGenerateText(options: {
  model?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
  enableThinking?: boolean
}): Promise<string> {
  const model = options.model || QwenTextModels.QWEN_FLASH
  const messages: Array<{ role: string, content: string }> = []
  if (options.systemInstruction) {
    messages.push({ role: 'system', content: options.systemInstruction })
  }
  messages.push({ role: 'user', content: options.prompt })
  const requestBody = {
    model,
    messages,
    temperature: options.temperature ?? 0.7
  }

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Qwen] generateText 请求参数:`, {
    model,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature ?? 0.7,
    enableThinking: options.enableThinking,
    maxRetries: options.maxRetries
  })

  return withModelDebugLog({
    provider: 'qwen',
    model,
    operation: 'generateText',
    request: requestBody,
    summarizeResponse: text => ({
      text,
      textLength: text.length
    }),
    execute: async () => withRetry(async () => {
      const response = await request<ChatCompletionResponse>(
        '/chat/completions',
        requestBody,
        { useCompatible: true }
      )

      return response.choices?.[0]?.message?.content || ''
    }, { maxRetries: options.maxRetries })
  })
}

export async function _qwenGenerateJSON<T>(options: {
  model?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<T> {
  const model = options.model || QwenTextModels.QWEN_FLASH
  const messages: Array<{ role: string, content: string }> = []
  if (options.systemInstruction) {
    messages.push({ role: 'system', content: options.systemInstruction })
  }
  messages.push({ role: 'user', content: options.prompt })
  const requestBody = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    response_format: { type: 'json_object' as const }
  }

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Qwen] generateJSON 请求参数:`, {
    model,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature ?? 0.2,
    maxRetries: options.maxRetries
  })

  return withModelDebugLog({
    provider: 'qwen',
    model,
    operation: 'generateJSON',
    request: requestBody,
    execute: async () => withRetry(async () => {
      const response = await request<ChatCompletionResponse>(
        '/chat/completions',
        requestBody,
        { useCompatible: true }
      )

      const text = response.choices?.[0]?.message?.content || '{}'

      // 尝试提取 JSON (支持对象和数组)
      let jsonStr = text.trim()

      // 1. 尝试匹配 markdown 代码块中的 JSON
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      if (codeBlockMatch && codeBlockMatch[1]) {
        jsonStr = codeBlockMatch[1].trim()
      } else {
        // 2. 尝试直接解析整个文本（如果是纯 JSON）
        try {
          JSON.parse(jsonStr)
          // 如果成功，直接使用
        } catch {
          // 3. 尝试匹配 JSON 对象（使用平衡括号匹配）
          const jsonMatch = extractJsonObject(text) || extractJsonArray(text)
          if (jsonMatch) {
            jsonStr = jsonMatch
          }
        }
      }

      try {
        return JSON.parse(jsonStr) as T
      } catch (parseError) {
        console.error('[Qwen] JSON 解析失败，原始文本:', text.slice(0, 1000))
        throw parseError
      }
    }, { maxRetries: options.maxRetries })
  })
}

/**
 * 提取平衡的 JSON 对象
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (char === '\\' && inString) {
      escape = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

/**
 * 提取平衡的 JSON 数组
 */
function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (char === '\\' && inString) {
      escape = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '[') depth++
    else if (char === ']') {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

// ============================================================
// 图片生成 API (通义万相)
// ============================================================

interface ImageGenerationResponse {
  output: {
    task_id: string
    task_status: string
  }
  request_id: string
}

interface ImageTaskStatusResponse {
  output: {
    task_id: string
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
    results?: Array<{ url: string }>
  }
  request_id: string
}

export async function _qwenGenerateImage(options: {
  model?: string
  prompt: string
  negativePrompt?: string
  size?: string
  n?: number
  referenceImages?: string[] // 参考图 URL 或 base64 (wan2.6-image 支持 1-4 张)
  maxRetries?: number
}): Promise<{ imageUrl: string, taskId: string }> {
  const model = options.model || QwenImageModels.WAN_2_6_T2I
  let upstreamRequestBody: unknown

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Qwen] generateImage 请求参数:`, {
    model,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    negativePrompt: options.negativePrompt,
    size: options.size || '1024*1024',
    n: options.n || 1,
    referenceImagesCount: options.referenceImages?.length || 0,
    maxRetries: options.maxRetries
  })

  return withModelDebugLog({
    provider: 'qwen',
    model,
    operation: 'generateImage',
    request: () => upstreamRequestBody,
    execute: async () => withRetry(async () => {
    // wan2.6-image 使用 messages 格式，支持参考图
    // 文档: https://help.aliyun.com/zh/model-studio/wan-image-generation-api-reference
    // 注意: wan2.6-image 是图像编辑模型，必须提供参考图
    // 如需纯文生图，请使用 wan2.6-t2i 或其他文生图模型
      if (model === QwenImageModels.WAN_2_6_IMAGE) {
      // 检查是否有参考图
        if (!options.referenceImages || options.referenceImages.length === 0) {
          throw new QwenError(
            '通义万相2.6-图像编辑是图像编辑模型，需要至少1张参考图。如需纯文生图，请选择"通义万相2.6-文生图"模型',
            QwenErrorCode.INVALID_ARGUMENT,
            400,
            false
          )
        }

        const content: Array<{ text?: string, image?: string }> = [
          { text: options.prompt }
        ]

        // 添加参考图 (1-4 张)
        for (const img of options.referenceImages.slice(0, 4)) {
          content.push({ image: img })
        }

        // wan2.6-image 要求总像素在 [768*768, 1280*1280] 之间
        const size = options.size || '1280*1280'

        const requestBody = {
          model,
          input: {
            messages: [
              {
                role: 'user',
                content
              }
            ]
          },
          parameters: {
            prompt_extend: true,
            negative_prompt: options.negativePrompt || '',
            size,
            n: options.n || 1,
            enable_interleave: false, // 图像编辑模式
            watermark: false
          }
        }
        upstreamRequestBody = requestBody

        const response = await request<{
          output: {
            choices: Array<{
              message: {
                content: Array<{ image?: string, text?: string, type?: string }>
              }
            }>
          }
          request_id: string
        }>(
          '/services/aigc/multimodal-generation/generation',
          requestBody
        )

        const imageUrl = response.output?.choices?.[0]?.message?.content?.find(c => c.image)?.image
        if (!imageUrl) {
          console.error(`[Qwen] ${model} 响应:`, JSON.stringify(response, null, 2))
          throw new QwenError(`${model} 图片生成失败`, QwenErrorCode.INTERNAL, 500, false)
        }
        console.log(`[Qwen] ${model} 图片生成成功: ${imageUrl.slice(0, 100)}...`)
        return { imageUrl, taskId: '' }
      }

      // qwen-image 系列和 z-image-turbo 使用同步 multimodal-generation 端点
      // 文档: https://help.aliyun.com/zh/model-studio/qwen-image-api
      // 文档: https://help.aliyun.com/zh/model-studio/z-image-turbo
      if (
        model === QwenImageModels.QWEN_IMAGE_2_PRO
        || model === QwenImageModels.QWEN_IMAGE_2
        || model === QwenImageModels.QWEN_IMAGE_PLUS
        || model === QwenImageModels.Z_IMAGE_TURBO
      ) {
      // 根据模型设置默认尺寸
        const defaultSize = (
          model === QwenImageModels.QWEN_IMAGE_2_PRO
          || model === QwenImageModels.QWEN_IMAGE_PLUS
        )
          ? '1328*1328'
          : '1024*1024'
        const size = options.size || defaultSize

        const requestBody = {
          model,
          input: {
            messages: [
              {
                role: 'user',
                content: [{ text: options.prompt }]
              }
            ]
          },
          parameters: {
            prompt_extend: (
              model === QwenImageModels.QWEN_IMAGE_2_PRO
              || model === QwenImageModels.QWEN_IMAGE_PLUS
            ),
            negative_prompt: options.negativePrompt || '',
            size
          }
        }
        upstreamRequestBody = requestBody

        const response = await request<{
          output: {
            choices: Array<{
              message: {
                content: Array<{ image?: string, text?: string }>
              }
            }>
          }
          request_id: string
        }>(
          '/services/aigc/multimodal-generation/generation',
          requestBody
        )

        const imageUrl = response.output?.choices?.[0]?.message?.content?.[0]?.image
        if (!imageUrl) {
          console.error(`[Qwen] ${model} 响应:`, JSON.stringify(response, null, 2))
          throw new QwenError(`${model} 图片生成失败`, QwenErrorCode.INTERNAL, 500, false)
        }
        console.log(`[Qwen] ${model} 图片生成成功: ${imageUrl.slice(0, 100)}...`)
        return { imageUrl, taskId: '' }
      }

      // wanx 系列模型使用异步任务模式
      const requestBody = {
        model,
        input: {
          prompt: options.prompt,
          negative_prompt: options.negativePrompt || ''
        },
        parameters: {
          size: options.size || '1024*1024',
          n: options.n || 1
        }
      }
      upstreamRequestBody = requestBody

      const submitResponse = await request<ImageGenerationResponse>(
        '/services/aigc/text2image/image-synthesis',
        requestBody,
        { headers: { 'X-DashScope-Async': 'enable' } }
      )

      const taskId = submitResponse.output.task_id
      console.log(`[Qwen] 图片任务已创建: ${taskId}`)

      // 2. 轮询任务状态
      const maxWaitTime = 120000 // 2分钟
      const pollInterval = 3000
      const startTime = Date.now()

      while (Date.now() - startTime < maxWaitTime) {
        await sleep(pollInterval)

        const statusResponse = await getTaskStatus<ImageTaskStatusResponse>(taskId)
        console.log(`[Qwen] 图片任务状态: ${statusResponse.output.task_status}`)

        if (statusResponse.output.task_status === 'SUCCEEDED') {
          const imageUrl = statusResponse.output.results?.[0]?.url
          if (!imageUrl) {
            throw new QwenError('图片生成成功但未返回URL', QwenErrorCode.INTERNAL, 500, false)
          }
          console.log(`[Qwen] 图片生成成功: ${imageUrl.slice(0, 100)}...`)
          return { imageUrl, taskId }
        }

        if (statusResponse.output.task_status === 'FAILED') {
          throw new QwenError('图片生成失败', QwenErrorCode.INTERNAL, 500, false)
        }
      }

      throw new QwenError('图片生成超时', QwenErrorCode.DEADLINE_EXCEEDED, 504, false)
    }, { maxRetries: options.maxRetries })
  })
}

// ============================================================
// 视频生成 API (通义万相)
// ============================================================

interface VideoGenerationResponse {
  output: {
    task_id: string
    task_status: string
  }
  request_id: string
}

interface VideoTaskStatusResponse {
  output: {
    task_id: string
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
    video_url?: string
    submit_time?: string
    scheduled_time?: string
    end_time?: string
    orig_prompt?: string
    actual_prompt?: string
    code?: string
    message?: string
  }
  usage?: {
    video_count: number
    video_duration?: number
    duration?: number
    video_ratio?: string
    size?: string
  }
  request_id: string
}

export async function _qwenGenerateVideo(options: {
  model?: string
  prompt: string
  imageUrl?: string // 图生视频时的输入图片
  firstFrameUrl?: string // 首帧图片 (首尾帧模型)
  lastFrameUrl?: string // 尾帧图片 (首尾帧模型)
  audioUrl?: string // 自定义音频
  duration?: number // 5, 10, 15
  size?: string // 如 '1280*720', '1920*1080'
  resolution?: string // 分辨率档位: 480P, 720P, 1080P (首尾帧模型)
  negativePrompt?: string
  promptExtend?: boolean
  audio?: boolean // 是否自动配音
  watermark?: boolean
  seed?: number
  maxRetries?: number
}): Promise<{ videoUrl: string, taskId: string }> {
  const normalizedResolution = typeof options.resolution === 'string'
    ? options.resolution.replace(/p$/i, 'P')
    : undefined

  // 判断是否使用首尾帧模型
  const isKf2vModel = options.model === QwenVideoModels.WAN_2_2_KF2V_FLASH
    || options.model === QwenVideoModels.WAN_2_1_KF2V_PLUS
    || (options.firstFrameUrl && options.lastFrameUrl)

  // 根据模型类型选择默认模型
  let model = options.model
  if (!model) {
    if (isKf2vModel || (options.firstFrameUrl && options.lastFrameUrl)) {
      model = QwenVideoModels.WAN_2_2_KF2V_FLASH // 默认使用推荐的首尾帧模型
    } else if (options.imageUrl) {
      model = QwenVideoModels.WAN_2_6_I2V
    } else {
      model = QwenVideoModels.WAN_2_6_T2V
    }
  }

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Qwen] generateVideo 请求参数:`, {
    model,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    hasImageUrl: !!options.imageUrl,
    imageUrlLength: options.imageUrl?.length || 0,
    hasFirstFrameUrl: !!options.firstFrameUrl,
    firstFrameUrlLength: options.firstFrameUrl?.length || 0,
    hasLastFrameUrl: !!options.lastFrameUrl,
    lastFrameUrlLength: options.lastFrameUrl?.length || 0,
    hasAudioUrl: !!options.audioUrl,
    duration: options.duration,
    size: options.size,
    resolution: normalizedResolution,
    negativePrompt: options.negativePrompt,
    promptExtend: options.promptExtend,
    audio: options.audio,
    watermark: options.watermark,
    seed: options.seed,
    maxRetries: options.maxRetries
  })

  let upstreamRequestBody: unknown

  return withModelDebugLog({
    provider: 'qwen',
    model,
    operation: 'generateVideo',
    request: () => upstreamRequestBody,
    execute: async () => withRetry(async () => {
    // 首尾帧模型使用不同的 API 端点和参数格式
      if (model === QwenVideoModels.WAN_2_2_KF2V_FLASH || model === QwenVideoModels.WAN_2_1_KF2V_PLUS) {
        if (!options.firstFrameUrl) {
          throw new QwenError(
            '首尾帧模型需要提供首帧图片 (firstFrameUrl)',
            QwenErrorCode.INVALID_ARGUMENT,
            400,
            false
          )
        }

        const input: Record<string, unknown> = {
          first_frame_url: options.firstFrameUrl
        }

        // 尾帧图片可选
        if (options.lastFrameUrl) {
          input.last_frame_url = options.lastFrameUrl
        }

        // 提示词可选
        if (options.prompt) {
          input.prompt = options.prompt
        }

        // 负面提示词
        if (options.negativePrompt) {
          input.negative_prompt = options.negativePrompt
        }

        const parameters: Record<string, unknown> = {}

        // 分辨率档位 (480P, 720P, 1080P)
        if (normalizedResolution) {
          parameters.resolution = normalizedResolution
        }
        if (options.promptExtend !== undefined) {
          parameters.prompt_extend = options.promptExtend
        }
        if (options.watermark !== undefined) {
          parameters.watermark = options.watermark
        }
        if (options.seed !== undefined) {
          parameters.seed = options.seed
        }

        // 首尾帧模型使用 image2video 端点
        const requestBody = {
          model,
          input,
          parameters
        }
        upstreamRequestBody = requestBody

        const submitResponse = await request<VideoGenerationResponse>(
          '/services/aigc/image2video/video-synthesis',
          requestBody,
          { headers: { 'X-DashScope-Async': 'enable' } }
        )

        const taskId = submitResponse.output.task_id
        console.log(`[Qwen] 首尾帧视频任务已创建: ${taskId}`)

        // 轮询任务状态
        const maxWaitTime = 600000 // 10分钟
        const pollInterval = 15000 // 首尾帧模型建议 15 秒轮询
        const startTime = Date.now()

        while (Date.now() - startTime < maxWaitTime) {
          await sleep(pollInterval)

          const statusResponse = await getTaskStatus<VideoTaskStatusResponse>(taskId)
          console.log(`[Qwen] 首尾帧视频任务状态: ${statusResponse.output.task_status}`)

          if (statusResponse.output.task_status === 'SUCCEEDED') {
            const videoUrl = statusResponse.output.video_url
            if (!videoUrl) {
              throw new QwenError('视频生成成功但未返回URL', QwenErrorCode.INTERNAL, 500, false)
            }
            return { videoUrl, taskId }
          }

          if (statusResponse.output.task_status === 'FAILED') {
            const errorMsg = statusResponse.output.message || '视频生成失败'
            throw new QwenError(errorMsg, QwenErrorCode.INTERNAL, 500, false)
          }

          if (statusResponse.output.task_status === 'UNKNOWN') {
            throw new QwenError('任务不存在或已过期', QwenErrorCode.NOT_FOUND, 404, false)
          }
        }

        throw new QwenError('视频生成超时', QwenErrorCode.DEADLINE_EXCEEDED, 504, false)
      }

      // 原有的文生视频/图生视频逻辑
      // 构建请求体
      const input: Record<string, unknown> = {
        prompt: options.prompt
      }

      // 图生视频模式
      if (options.imageUrl) {
        input.img_url = options.imageUrl
      }

      // 自定义音频
      if (options.audioUrl) {
        input.audio_url = options.audioUrl
      }

      // 负面提示词
      if (options.negativePrompt) {
        input.negative_prompt = options.negativePrompt
      }

      const parameters: Record<string, unknown> = {}

      if (options.size) {
        parameters.size = options.size
      }
      if (options.duration) {
        parameters.duration = options.duration
      }
      if (options.promptExtend !== undefined) {
        parameters.prompt_extend = options.promptExtend
      }
      if (options.audio !== undefined) {
        parameters.audio = options.audio
      }
      if (options.watermark !== undefined) {
        parameters.watermark = options.watermark
      }
      if (options.seed !== undefined) {
        parameters.seed = options.seed
      }

      // 1. 提交生成任务
      const requestBody = {
        model,
        input,
        parameters
      }
      upstreamRequestBody = requestBody

      const submitResponse = await request<VideoGenerationResponse>(
        '/services/aigc/video-generation/video-synthesis',
        requestBody,
        { headers: { 'X-DashScope-Async': 'enable' } }
      )

      const taskId = submitResponse.output.task_id
      console.log(`[Qwen] 视频任务已创建: ${taskId}`)

      // 2. 轮询任务状态 (视频生成时间较长)
      const maxWaitTime = 600000 // 10分钟
      const pollInterval = 10000
      const startTime = Date.now()

      while (Date.now() - startTime < maxWaitTime) {
        await sleep(pollInterval)

        const statusResponse = await getTaskStatus<VideoTaskStatusResponse>(taskId)
        console.log(`[Qwen] 视频任务状态: ${statusResponse.output.task_status}`)

        if (statusResponse.output.task_status === 'SUCCEEDED') {
          const videoUrl = statusResponse.output.video_url
          if (!videoUrl) {
            throw new QwenError('视频生成成功但未返回URL', QwenErrorCode.INTERNAL, 500, false)
          }
          return { videoUrl, taskId }
        }

        if (statusResponse.output.task_status === 'FAILED') {
          const errorMsg = statusResponse.output.message || '视频生成失败'
          throw new QwenError(errorMsg, QwenErrorCode.INTERNAL, 500, false)
        }

        if (statusResponse.output.task_status === 'UNKNOWN') {
          throw new QwenError('任务不存在或已过期', QwenErrorCode.NOT_FOUND, 404, false)
        }
      }

      throw new QwenError('视频生成超时', QwenErrorCode.DEADLINE_EXCEEDED, 504, false)
    }, { maxRetries: options.maxRetries })
  })
}

// ============================================================
// TTS 语音合成 API
// ============================================================

interface TTSResponse {
  output: {
    audio?: string // base64
    audio_url?: string
  }
  request_id: string
}

export async function _qwenTextToSpeech(options: {
  model?: string
  text: string
  voice?: string
  speed?: number
  format?: string // mp3, wav, pcm
  sampleRate?: number
  languageType?: string // Chinese, English, etc.
  maxRetries?: number
}): Promise<{ audioData: string, audioUrl?: string }> {
  const model = options.model || QwenVoiceModels.QWEN3_TTS_FLASH
  let upstreamRequestBody: unknown

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Qwen] textToSpeech 请求参数:`, {
    model,
    textLength: options.text.length,
    text: options.text,
    voice: options.voice,
    speed: options.speed,
    format: options.format,
    sampleRate: options.sampleRate,
    languageType: options.languageType,
    maxRetries: options.maxRetries
  })

  return withModelDebugLog({
    provider: 'qwen',
    model,
    operation: 'textToSpeech',
    request: () => upstreamRequestBody,
    summarizeResponse: result => ({
      audioUrl: result.audioUrl,
      audioDataLength: result.audioData?.length || 0
    }),
    execute: async () => withRetry(async () => {
    // qwen3-tts-instruct-flash 使用新的 multimodal-generation 端点
    // 文档: https://help.aliyun.com/zh/model-studio/qwen-tts-api
      if (model === QwenVoiceModels.QWEN3_TTS_FLASH) {
        const requestBody = {
          model,
          input: {
            text: options.text,
            voice: options.voice || 'Cherry',
            language_type: options.languageType || 'Chinese'
          }
        }
        upstreamRequestBody = requestBody

        const response = await request<{
          output: {
            audio?: {
              data?: string
              url?: string
              id?: string
              expires_at?: number
            }
            finish_reason?: string
          }
          usage?: {
            characters?: number
          }
          request_id: string
        }>(
          '/services/aigc/multimodal-generation/generation',
          requestBody
        )

        const audioUrl = response.output?.audio?.url
        const audioData = response.output?.audio?.data || ''

        if (!audioUrl && !audioData) {
          console.error('[Qwen] TTS 响应:', JSON.stringify(response, null, 2))
          throw new QwenError('TTS 生成失败', QwenErrorCode.INTERNAL, 500, false)
        }

        console.log(`[Qwen] TTS 生成成功: ${audioUrl?.slice(0, 100)}...`)
        return { audioData, audioUrl }
      }

      // 旧版 TTS 模型使用原有端点
      const requestBody = {
        model,
        input: {
          text: options.text
        },
        parameters: {
          voice: options.voice || 'longxiaochun',
          speed: options.speed ?? 1.0,
          format: options.format || 'mp3',
          sample_rate: options.sampleRate || 22050
        }
      }
      upstreamRequestBody = requestBody

      const response = await request<TTSResponse>(
        '/services/aigc/text2audio/speech-synthesis',
        requestBody
      )

      const audioData = response.output.audio || ''
      const audioUrl = response.output.audio_url

      if (!audioData && !audioUrl) {
        throw new QwenError('TTS 生成失败', QwenErrorCode.INTERNAL, 500, false)
      }

      return { audioData, audioUrl }
    }, { maxRetries: options.maxRetries })
  })
}

// ============================================================
// ASR 语音识别 API
// ============================================================

interface ASRResponse {
  output: {
    text: string
  }
  request_id: string
}

export async function _qwenSpeechToText(options: {
  model?: string
  audioUrl?: string
  audioData?: string // base64
  language?: string
  maxRetries?: number
}): Promise<{ text: string }> {
  const model = options.model || QwenVoiceModels.QWEN3_ASR_FLASH
  let upstreamRequestBody: unknown

  console.log('[Qwen] speechToText 请求参数:', {
    model,
    hasAudioUrl: !!options.audioUrl,
    hasAudioData: !!options.audioData,
    language: options.language
  })

  return withModelDebugLog({
    provider: 'qwen',
    model,
    operation: 'speechToText',
    request: () => upstreamRequestBody,
    summarizeResponse: result => ({
      text: result.text,
      textLength: result.text.length
    }),
    execute: async () => withRetry(async () => {
      const input: Record<string, unknown> = {}
      if (options.audioUrl) {
        input.file_urls = [options.audioUrl]
      } else if (options.audioData) {
        input.audio = options.audioData
      }

      const requestBody = {
        model,
        input,
        parameters: {
          language_hints: options.language ? [options.language] : ['zh', 'en']
        }
      }
      upstreamRequestBody = requestBody

      const response = await request<ASRResponse>(
        '/services/aigc/audio2text/speech-recognition',
        requestBody
      )

      return { text: response.output.text }
    }, { maxRetries: options.maxRetries })
  })
}
