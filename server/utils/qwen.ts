/**
 * 阿里云千问 (Qwen) API 封装
 * 基于阿里云百炼平台 DashScope API
 * 
 * 文档参考: https://help.aliyun.com/zh/model-studio/
 */

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
  QWEN_PLUS_THINKING: 'qwen-plus-2025-07-28',
  QWEN_FLASH_THINKING: 'qwen-flash-2025-07-28',
  
  // 通用文本模型
  QWEN3_MAX: 'qwen3-max',
  QWEN_FLASH: 'qwen-flash',
  QWEN_TURBO: 'qwen-turbo',
  
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
  QWEN_IMAGE_PLUS: 'qwen-image-plus',
  WAN_2_6_T2I: 'wan2.6-t2i',
  Z_IMAGE_TURBO: 'z-image-turbo'
} as const

/** 千问视频生成模型 (通义万相) */
export const QwenVideoModels = {
  WAN_2_6_T2V: 'wan2.6-t2v',      // 文生视频
  WAN_2_6_I2V: 'wan2.6-i2v'       // 图生视频
} as const

/** 千问语音模型 */
export const QwenVoiceModels = {
  QWEN3_TTS_FLASH: 'qwen3-tts-flash',
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
    case 400: code = QwenErrorCode.INVALID_ARGUMENT; break
    case 403: code = QwenErrorCode.PERMISSION_DENIED; break
    case 404: code = QwenErrorCode.NOT_FOUND; break
    case 429: code = QwenErrorCode.RESOURCE_EXHAUSTED; break
    case 500: code = QwenErrorCode.INTERNAL; break
    case 503: code = QwenErrorCode.UNAVAILABLE; break
    case 504: code = QwenErrorCode.DEADLINE_EXCEEDED; break
    default: code = QwenErrorCode.UNKNOWN
  }

  return new QwenError(message, code, status, RETRYABLE_ERROR_CODES.has(code))
}

/** @internal */
async function withRetry<T>(
  fn: () => Promise<T>,
  retryConfig: Partial<RetryConfig> = {}
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
  let lastError: QwenError | null = null

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = parseError(error)
      if (!lastError.retryable || attempt === cfg.maxRetries) {
        throw lastError
      }
      const delay = calculateBackoffDelay(attempt, cfg)
      console.warn(`[Qwen] 请求失败 (${lastError.code}), ${delay.toFixed(0)}ms 后重试...`)
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
      const errorData = await response.json().catch(() => ({}))
      throw new QwenError(
        errorData.message || `HTTP ${response.status}`,
        QwenErrorCode.UNKNOWN,
        response.status,
        response.status >= 500 || response.status === 429
      )
    }

    return await response.json() as T
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
      'Authorization': `Bearer ${cfg.apiKey}`
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

  console.log('[Qwen] generateText 请求参数:', {
    model,
    promptLength: options.prompt.length,
    promptPreview: options.prompt.slice(0, 200) + (options.prompt.length > 200 ? '...' : ''),
    systemInstruction: options.systemInstruction?.slice(0, 100),
    temperature: options.temperature,
    enableThinking: options.enableThinking
  })

  return withRetry(async () => {
    const messages: Array<{ role: string, content: string }> = []
    
    if (options.systemInstruction) {
      messages.push({ role: 'system', content: options.systemInstruction })
    }
    messages.push({ role: 'user', content: options.prompt })

    const response = await request<ChatCompletionResponse>(
      '/chat/completions',
      {
        model,
        messages,
        temperature: options.temperature ?? 0.7
      },
      { useCompatible: true }
    )

    return response.choices?.[0]?.message?.content || ''
  }, { maxRetries: options.maxRetries })
}

export async function _qwenGenerateJSON<T>(options: {
  model?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<T> {
  const model = options.model || QwenTextModels.QWEN_FLASH

  console.log('[Qwen] generateJSON 请求参数:', {
    model,
    promptLength: options.prompt.length,
    temperature: options.temperature ?? 0.2
  })

  return withRetry(async () => {
    const messages: Array<{ role: string, content: string }> = []
    
    if (options.systemInstruction) {
      messages.push({ role: 'system', content: options.systemInstruction })
    }
    messages.push({ role: 'user', content: options.prompt })

    const response = await request<ChatCompletionResponse>(
      '/chat/completions',
      {
        model,
        messages,
        temperature: options.temperature ?? 0.2,
        response_format: { type: 'json_object' }
      },
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
  maxRetries?: number
}): Promise<{ imageUrl: string, taskId: string }> {
  const model = options.model || QwenImageModels.WAN_2_6_T2I

  console.log('[Qwen] generateImage 请求参数:', {
    model,
    promptLength: options.prompt.length,
    size: options.size || '1024*1024',
    n: options.n || 1
  })

  return withRetry(async () => {
    // 1. 提交生成任务
    const submitResponse = await request<ImageGenerationResponse>(
      '/services/aigc/text2image/image-synthesis',
      {
        model,
        input: {
          prompt: options.prompt,
          negative_prompt: options.negativePrompt
        },
        parameters: {
          size: options.size || '1024*1024',
          n: options.n || 1
        }
      },
      { headers: { 'X-DashScope-Async': 'enable' } }
    )

    const taskId = submitResponse.output.task_id

    // 2. 轮询任务状态
    const maxWaitTime = 120000 // 2分钟
    const pollInterval = 3000
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitTime) {
      await sleep(pollInterval)

      const statusResponse = await getTaskStatus<ImageTaskStatusResponse>(taskId)

      if (statusResponse.output.task_status === 'SUCCEEDED') {
        const imageUrl = statusResponse.output.results?.[0]?.url
        if (!imageUrl) {
          throw new QwenError('图片生成成功但未返回URL', QwenErrorCode.INTERNAL, 500, false)
        }
        return { imageUrl, taskId }
      }

      if (statusResponse.output.task_status === 'FAILED') {
        throw new QwenError('图片生成失败', QwenErrorCode.INTERNAL, 500, false)
      }
    }

    throw new QwenError('图片生成超时', QwenErrorCode.DEADLINE_EXCEEDED, 504, false)
  }, { maxRetries: options.maxRetries })
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
  imageUrl?: string  // 图生视频时的输入图片
  audioUrl?: string  // 自定义音频
  duration?: number  // 5, 10, 15
  size?: string      // 如 '1280*720', '1920*1080'
  negativePrompt?: string
  promptExtend?: boolean
  audio?: boolean    // 是否自动配音
  watermark?: boolean
  seed?: number
  maxRetries?: number
}): Promise<{ videoUrl: string, taskId: string }> {
  // 根据是否有图片选择模型
  const model = options.model || (options.imageUrl ? QwenVideoModels.WAN_2_6_I2V : QwenVideoModels.WAN_2_6_T2V)

  console.log('[Qwen] generateVideo 请求参数:', {
    model,
    promptLength: options.prompt.length,
    hasImageUrl: !!options.imageUrl,
    hasAudioUrl: !!options.audioUrl,
    duration: options.duration,
    size: options.size
  })

  return withRetry(async () => {
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
    const submitResponse = await request<VideoGenerationResponse>(
      '/services/aigc/video-generation/video-synthesis',
      {
        model,
        input,
        parameters
      },
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
}

// ============================================================
// TTS 语音合成 API
// ============================================================

interface TTSResponse {
  output: {
    audio?: string  // base64
    audio_url?: string
  }
  request_id: string
}

export async function _qwenTextToSpeech(options: {
  model?: string
  text: string
  voice?: string
  speed?: number
  format?: string  // mp3, wav, pcm
  sampleRate?: number
  maxRetries?: number
}): Promise<{ audioData: string, audioUrl?: string }> {
  const model = options.model || QwenVoiceModels.QWEN3_TTS_FLASH

  console.log('[Qwen] textToSpeech 请求参数:', {
    model,
    textLength: options.text.length,
    voice: options.voice,
    speed: options.speed
  })

  return withRetry(async () => {
    const response = await request<TTSResponse>(
      '/services/aigc/text2audio/speech-synthesis',
      {
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
    )

    const audioData = response.output.audio || ''
    const audioUrl = response.output.audio_url

    if (!audioData && !audioUrl) {
      throw new QwenError('TTS 生成失败', QwenErrorCode.INTERNAL, 500, false)
    }

    return { audioData, audioUrl }
  }, { maxRetries: options.maxRetries })
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
  audioData?: string  // base64
  language?: string
  maxRetries?: number
}): Promise<{ text: string }> {
  const model = options.model || QwenVoiceModels.QWEN3_ASR_FLASH

  console.log('[Qwen] speechToText 请求参数:', {
    model,
    hasAudioUrl: !!options.audioUrl,
    hasAudioData: !!options.audioData,
    language: options.language
  })

  return withRetry(async () => {
    const input: Record<string, unknown> = {}
    if (options.audioUrl) {
      input.file_urls = [options.audioUrl]
    } else if (options.audioData) {
      input.audio = options.audioData
    }

    const response = await request<ASRResponse>(
      '/services/aigc/audio2text/speech-recognition',
      {
        model,
        input,
        parameters: {
          language_hints: options.language ? [options.language] : ['zh', 'en']
        }
      }
    )

    return { text: response.output.text }
  }, { maxRetries: options.maxRetries })
}
