/**
 * 火山引擎 (Volcengine) 方舟平台 API 封装
 * 基于火山引擎方舟大模型服务平台
 * 
 * 文档参考: https://www.volcengine.com/docs/82379/1330310
 * 更新日期: 2026.04.03
 */

// ============================================================
// 错误类型定义
// ============================================================

export enum VolcengineErrorCode {
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NOT_FOUND = 'NOT_FOUND',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',
  INTERNAL = 'INTERNAL',
  UNAVAILABLE = 'UNAVAILABLE',
  DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED',
  UNKNOWN = 'UNKNOWN'
}

export class VolcengineError extends Error {
  constructor(
    message: string,
    public code: VolcengineErrorCode,
    public status?: number,
    public retryable: boolean = false
  ) {
    super(message)
    this.name = 'VolcengineError'
  }
}

const RETRYABLE_ERROR_CODES = new Set([
  VolcengineErrorCode.RESOURCE_EXHAUSTED,
  VolcengineErrorCode.INTERNAL,
  VolcengineErrorCode.UNAVAILABLE,
  VolcengineErrorCode.DEADLINE_EXCEEDED
])

// ============================================================
// 模型配置 (基于火山引擎方舟平台 2026.04.03 更新)
// ============================================================

/** 火山引擎文本模型 (豆包系列) */
export const VolcengineTextModels = {
  // 最新 Seed 2.0 系列
  DOUBAO_SEED_2_0_PRO: 'doubao-seed-2-0-pro-260215',
  DOUBAO_SEED_2_0_MINI: 'doubao-seed-2-0-mini-260215',
  DOUBAO_SEED_2_0_LITE: 'doubao-seed-2-0-lite-260215',
  // 编程场景增强（最新可用）
  DOUBAO_SEED_CODE: 'doubao-seed-code-preview-251028',
  // DeepSeek 最新版
  DEEPSEEK_V3_2: 'deepseek-v3-2-251201',
  // 兼容旧字段，映射到可用新模型
  DOUBAO_SEED_1_8: 'doubao-seed-2-0-pro-260215',
  DOUBAO_SEED_LITE: 'doubao-seed-2-0-lite-260215',
  DOUBAO_SEED_FLASH: 'doubao-seed-2-0-mini-260215'
} as const

/** 火山引擎图片生成模型 (豆包 Seedream 系列) */
export const VolcengineImageModels = {
  // 最新 Seedream 5.0 系列
  SEEDREAM_5_0: 'doubao-seedream-5-0-260128',
  SEEDREAM_5_0_LITE: 'doubao-seedream-5-0-lite-260128',
  // 高质量模型
  SEEDREAM_4_5: 'doubao-seedream-4-5-251128',
  // 兼容旧字段
  SEEDREAM_4_0: 'doubao-seedream-4-5-251128',
  SEEDREAM_3_0_T2I: 'doubao-seedream-5-0-lite-260128'
} as const

/** 火山引擎视频生成模型 (豆包 Seedance 系列) - 仅保留支持首尾帧的模型 */
export const VolcengineVideoModels = {
  // 最新 Seedance 2.0 系列
  SEEDANCE_2_0: 'doubao-seedance-2-0-260128',
  SEEDANCE_2_0_FAST: 'doubao-seedance-2-0-fast-260128',
  // 兼容旧字段，映射到可用新模型
  SEEDANCE_1_5_PRO: 'doubao-seedance-2-0-260128',
  SEEDANCE_1_0_PRO: 'doubao-seedance-2-0-fast-260128',
  SEEDANCE_1_0_LITE_I2V: 'doubao-seedance-2-0-fast-260128'
} as const

/** 火山引擎向量化模型 */
export const VolcengineEmbeddingModels = {
  // 多模态向量化，128k上下文
  EMBEDDING_VISION: 'doubao-embedding-vision-251215'
} as const

// ============================================================
// API 配置
// ============================================================

// 火山引擎方舟平台 API 基础 URL (OpenAI 兼容模式)
const VOLCENGINE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

interface VolcengineConfig {
  apiKey: string
  baseUrl: string
}

let config: VolcengineConfig | null = null

function getConfig(): VolcengineConfig {
  if (!config) {
    const runtimeConfig = useRuntimeConfig()
    const apiKey = runtimeConfig.volcengineApiKey as string

    if (!apiKey) {
      throw new VolcengineError(
        'VOLCENGINE_API_KEY 环境变量未设置',
        VolcengineErrorCode.PERMISSION_DENIED,
        403,
        false
      )
    }

    config = {
      apiKey,
      baseUrl: VOLCENGINE_BASE_URL
    }
  }
  return config
}


// ============================================================
// 重试配置
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

function detectImageMimeType(base64Payload: string): string {
  const head = base64Payload.trim()
  if (head.startsWith('/9j/')) return 'image/jpeg'
  if (head.startsWith('iVBOR')) return 'image/png'
  if (head.startsWith('R0lGOD')) return 'image/gif'
  if (head.startsWith('UklGR')) return 'image/webp'
  if (head.startsWith('Qk')) return 'image/bmp'
  if (head.startsWith('SUkq') || head.startsWith('TU0A')) return 'image/tiff'
  return 'image/png'
}

function isLikelyBase64Image(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return compact.startsWith('/9j/')
    || compact.startsWith('iVBOR')
    || compact.startsWith('R0lGOD')
    || compact.startsWith('UklGR')
    || compact.startsWith('Qk')
    || compact.startsWith('SUkq')
    || compact.startsWith('TU0A')
}

function normalizeVideoImageInput(value?: string): string | undefined {
  if (!value) return undefined
  const raw = value.trim()
  if (!raw) return undefined

  if (
    raw.startsWith('http://')
    || raw.startsWith('https://')
    || raw.startsWith('asset://')
  ) {
    return raw
  }

  if (raw.startsWith('/') && !isLikelyBase64Image(raw)) {
    return raw
  }

  const dataUriMatch = raw.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (dataUriMatch?.[2]) {
    const payload = dataUriMatch[2].replace(/\s+/g, '')
    const detectedMime = detectImageMimeType(payload)
    return `data:${detectedMime};base64,${payload}`
  }

  // 兜底：按纯 base64 输入处理
  const payload = raw.replace(/\s+/g, '')
  const detectedMime = detectImageMimeType(payload)
  return `data:${detectedMime};base64,${payload}`
}

function resolveImageInputKind(value?: string): 'none' | 'http' | 'asset' | 'data-uri' | 'path' | 'raw' {
  if (!value) return 'none'
  if (value.startsWith('http://') || value.startsWith('https://')) return 'http'
  if (value.startsWith('asset://')) return 'asset'
  if (value.startsWith('data:image/')) return 'data-uri'
  if (value.startsWith('/')) return 'path'
  return 'raw'
}

function parseError(error: unknown): VolcengineError {
  if (error instanceof VolcengineError) {
    return error
  }

  const err = error as { status?: number, message?: string, code?: string }
  const status = err.status || 500
  const message = err.message || '未知错误'

  let code: VolcengineErrorCode
  switch (status) {
    case 400: code = VolcengineErrorCode.INVALID_ARGUMENT; break
    case 403: code = VolcengineErrorCode.PERMISSION_DENIED; break
    case 404: code = VolcengineErrorCode.NOT_FOUND; break
    case 429: code = VolcengineErrorCode.RESOURCE_EXHAUSTED; break
    case 500: code = VolcengineErrorCode.INTERNAL; break
    case 503: code = VolcengineErrorCode.UNAVAILABLE; break
    case 504: code = VolcengineErrorCode.DEADLINE_EXCEEDED; break
    default: code = VolcengineErrorCode.UNKNOWN
  }

  return new VolcengineError(message, code, status, RETRYABLE_ERROR_CODES.has(code))
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retryConfig: Partial<RetryConfig> = {}
): Promise<T> {
  const filteredConfig = Object.fromEntries(
    Object.entries(retryConfig).filter(([, v]) => v !== undefined)
  )
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...filteredConfig }
  let lastError: VolcengineError = new VolcengineError('未知错误', VolcengineErrorCode.UNKNOWN, 500, false)

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = parseError(error)
      console.warn(`[Volcengine] 请求失败 (attempt ${attempt + 1}/${cfg.maxRetries + 1}):`, lastError.message)
      if (!lastError.retryable || attempt === cfg.maxRetries) {
        throw lastError
      }
      const delay = calculateBackoffDelay(attempt, cfg)
      console.warn(`[Volcengine] ${delay.toFixed(0)}ms 后重试...`)
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
  options: { timeout?: number, method?: 'POST' | 'GET' } = {}
): Promise<T> {
  const cfg = getConfig()
  const url = `${cfg.baseUrl}${endpoint}`
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
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    }

    if (method === 'POST' && body) {
      fetchOptions.body = JSON.stringify(body)
    }

    const response = await fetch(url, fetchOptions)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: { message?: string, code?: string } }
      console.error('[Volcengine] API 错误响应:', {
        status: response.status,
        errorData,
        url,
        body: JSON.stringify(body).slice(0, 500)
      })
      throw new VolcengineError(
        errorData.error?.message || `HTTP ${response.status}`,
        VolcengineErrorCode.UNKNOWN,
        response.status,
        response.status >= 500 || response.status === 429
      )
    }

    return await response.json() as T
  } catch (error) {
    if (error instanceof VolcengineError) throw error
    console.error('[Volcengine] 请求异常:', error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

// ============================================================
// 文本生成 API (OpenAI 兼容模式)
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

const VOLCENGINE_STRUCTURED_OUTPUT_MODELS = new Set<string>([
  VolcengineTextModels.DOUBAO_SEED_2_0_MINI,
  VolcengineTextModels.DOUBAO_SEED_2_0_LITE,
  VolcengineTextModels.DEEPSEEK_V3_2
])

const VOLCENGINE_DEFAULT_STRUCTURED_JSON_MODEL = VolcengineTextModels.DOUBAO_SEED_2_0_MINI
const VOLCENGINE_DEFAULT_MAX_TOKENS = 4096
const VOLCENGINE_MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  [VolcengineTextModels.DOUBAO_SEED_2_0_PRO]: 128 * 1024,
  [VolcengineTextModels.DOUBAO_SEED_2_0_LITE]: 128 * 1024,
  [VolcengineTextModels.DOUBAO_SEED_2_0_MINI]: 128 * 1024,
  [VolcengineTextModels.DOUBAO_SEED_CODE]: 128 * 1024,
  [VolcengineTextModels.DEEPSEEK_V3_2]: 32 * 1024
}

function resolveStructuredJsonModel(model: string): string {
  if (VOLCENGINE_STRUCTURED_OUTPUT_MODELS.has(model)) {
    return model
  }

  console.warn(
    `[Volcengine] 模型 ${model} 不支持 response_format=json_schema，JSON 任务自动切换到 ${VOLCENGINE_DEFAULT_STRUCTURED_JSON_MODEL}`
  )
  return VOLCENGINE_DEFAULT_STRUCTURED_JSON_MODEL
}

function resolveModelMaxTokens(model: string): number {
  return VOLCENGINE_MODEL_MAX_OUTPUT_TOKENS[model] ?? VOLCENGINE_DEFAULT_MAX_TOKENS
}

export async function _volcengineGenerateText(options: {
  model?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
  enableThinking?: boolean
}): Promise<string> {
  const model = options.model || VolcengineTextModels.DOUBAO_SEED_2_0_MINI

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Volcengine] generateText 请求参数:`, {
    model,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature ?? 0.7,
    enableThinking: options.enableThinking,
    maxRetries: options.maxRetries
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
      }
    )

    return response.choices?.[0]?.message?.content || ''
  }, { maxRetries: options.maxRetries })
}

export async function _volcengineGenerateJSON<T>(options: {
  model?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<T> {
  const requestedModel = options.model || VolcengineTextModels.DOUBAO_SEED_2_0_MINI
  const model = resolveStructuredJsonModel(requestedModel)
  const maxTokens = resolveModelMaxTokens(model)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Volcengine] generateJSON 请求参数:`, {
    requestedModel,
    model,
    maxTokens,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature ?? 0.2,
    maxRetries: options.maxRetries
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
        temperature: Math.min(options.temperature ?? 0.2, 0.2),
        // 按模型支持上限设置，避免长 JSON 输出被默认值截断
        max_tokens: maxTokens,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'structured_response',
            strict: true,
            schema: {
              anyOf: [
                { type: 'object' },
                { type: 'array' }
              ]
            }
          }
        }
      }
    )

    const text = response.choices?.[0]?.message?.content || ''
    const finishReason = response.choices?.[0]?.finish_reason
    let jsonStr = normalizeJsonCandidate(text)

    // 优先提取 markdown 代码块中的 JSON，兼容模型偶发包裹 ```json ... ```
    const codeBlockMatch =
      text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
      || text.match(/``(?:json)?\s*([\s\S]*?)\s*``/i)

    if (codeBlockMatch && codeBlockMatch[1]) {
      jsonStr = normalizeJsonCandidate(codeBlockMatch[1])
    } else {
      // 兼容仅有起始代码块、没有结束代码块的情况
      const openFenceMatch = text.match(/^\s*`{2,3}(?:json)?\s*([\s\S]*)$/i)
      if (openFenceMatch && openFenceMatch[1]) {
        jsonStr = normalizeJsonCandidate(openFenceMatch[1])
      }

      // 若非纯 JSON，尝试从文本中提取平衡对象/数组
      try {
        JSON.parse(jsonStr)
      } catch {
        const extracted = extractJsonObject(jsonStr)
          || extractJsonArray(jsonStr)
          || extractJsonObject(text)
          || extractJsonArray(text)
        if (extracted) {
          jsonStr = normalizeJsonCandidate(extracted)
        }
      }
    }

    try {
      return JSON.parse(jsonStr) as T
    } catch (parseError) {
      console.error('[Volcengine] JSON 解析失败，响应内容:', text.slice(0, 1000))

      if (finishReason === 'length') {
        throw new VolcengineError(
          `模型输出被截断（finish_reason=length），当前 max_tokens=${maxTokens}。请缩短输出内容或分批生成。`,
          VolcengineErrorCode.INVALID_ARGUMENT,
          400,
          false
        )
      }

      throw parseError
    }
  }, { maxRetries: options.maxRetries })
}

function normalizeJsonCandidate(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/^\s*`{2,3}\s*json\b/i, '')
    .replace(/^\s*`{2,3}/, '')
    .replace(/\s*`{2,3}\s*$/, '')
    .trim()
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
// 图片生成 API (豆包 Seedream)
// ============================================================

interface ImageGenerationResponse {
  data: Array<{
    url?: string
    b64_json?: string
  }>
  created: number
}

export async function _volcengineGenerateImage(options: {
  model?: string
  prompt: string
  negativePrompt?: string
  size?: string
  n?: number
  referenceImages?: string[]
  maxRetries?: number
}): Promise<{ imageUrl: string }> {
  const model = options.model || VolcengineImageModels.SEEDREAM_5_0
  const isSeedreamHighModel =
    model.includes('seedream-5-0')
    || model.includes('seedream-4-5')
    || model.includes('seedream-4-0')
  const defaultSize = isSeedreamHighModel ? '2K' : '1024x1024'

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Volcengine] generateImage 请求参数:`, {
    model,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    negativePrompt: options.negativePrompt,
    size: options.size || defaultSize,
    n: options.n || 1,
    referenceImagesCount: options.referenceImages?.length || 0,
    maxRetries: options.maxRetries
  })

  return withRetry(async () => {
    // Seedream 5.0/4.5/4.0 推荐使用 2K/4K，由模型结合提示词决定更合适的宽高比
    let size = options.size || defaultSize
    // 兼容 * 分隔符
    size = size.replace('*', 'x')
    
    // Seedream 5.0/4.5/4.0 要求图片尺寸至少 3686400 像素 (约 1920x1920)
    // 仅当传入的是明确宽高值时进行像素校验；2K/4K 由平台自行处理
    if (isSeedreamHighModel && /^\d+x\d+$/i.test(size)) {
      const [width = 0, height = 0] = size.split('x').map(v => Number(v) || 0)
      if (width * height < 3686400) {
        size = '2K'
        console.log(`[Volcengine] 模型 ${model} 要求更大尺寸，自动调整为 ${size}`)
      }
    }
    
    const requestBody: Record<string, unknown> = {
      model,
      prompt: options.prompt,
      n: options.n || 1,
      size,
      watermark: false  // 去掉水印
    }

    if (options.negativePrompt) {
      requestBody.negative_prompt = options.negativePrompt
    }

    // 参考图支持 (图生图模式)
    // 火山引擎 API 要求:
    // - URL: 必须是公网可访问的 URL
    // - Base64: 必须是 data:image/<格式>;base64,<数据> 格式
    if (options.referenceImages && options.referenceImages.length > 0) {
      const refImage = options.referenceImages[0]
      if (!refImage) {
        throw new VolcengineError('参考图不能为空', VolcengineErrorCode.INVALID_ARGUMENT, 400, false)
      }

      // 判断是否已经是正确格式
      if (refImage.startsWith('http://') || refImage.startsWith('https://')) {
        // URL 格式 - 直接使用 (注意: 必须是公网可访问的 URL)
        requestBody.image = refImage
      } else if (refImage.startsWith('data:image/')) {
        // 已经是正确的 data URI 格式
        requestBody.image = refImage
      } else {
        // 纯 base64 字符串，需要添加 data URI 前缀
        // 尝试检测图片格式 (通过 base64 头部特征)
        let mimeType = 'png' // 默认 png
        if (refImage.startsWith('/9j/')) {
          mimeType = 'jpeg'
        } else if (refImage.startsWith('iVBOR')) {
          mimeType = 'png'
        } else if (refImage.startsWith('R0lGOD')) {
          mimeType = 'gif'
        } else if (refImage.startsWith('UklGR')) {
          mimeType = 'webp'
        }
        requestBody.image = `data:image/${mimeType};base64,${refImage}`
        console.log(`[Volcengine] 参考图转换为 data URI 格式: image/${mimeType}`)
      }
    }

    const response = await request<ImageGenerationResponse>(
      '/images/generations',
      requestBody
    )

    const imageUrl = response.data?.[0]?.url
    if (!imageUrl) {
      throw new VolcengineError('图片生成失败', VolcengineErrorCode.INTERNAL, 500, false)
    }

    console.log(`[Volcengine] 图片生成成功: ${imageUrl.slice(0, 100)}...`)
    return { imageUrl }
  }, { maxRetries: options.maxRetries })
}

// ============================================================
// 视频生成 API (豆包 Seedance)
// 使用异步任务 API: /contents/generations/tasks
// 文档: https://www.volcengine.com/docs/82379/1520757
// ============================================================

// 创建任务的响应
interface CreateTaskResponse {
  id: string
  model?: string
  status?: string
}

// 查询任务的响应 (根据官方文档: https://www.volcengine.com/docs/82379/1521309)
interface QueryTaskResponse {
  id: string
  model: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired'
  content?: {
    video_url?: string
    last_frame_url?: string
  }
  error?: { 
    code?: string
    message?: string 
  }
  seed?: number
  resolution?: string
  ratio?: string
  duration?: number
  framespersecond?: number
  created_at?: number
  updated_at?: number
}

export async function _volcengineGenerateVideo(options: {
  model?: string
  prompt: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  duration?: number
  size?: string
  resolution?: string
  negativePrompt?: string
  maxRetries?: number
}): Promise<{ videoUrl: string, taskId: string }> {
  const normalizedImageUrl = normalizeVideoImageInput(options.imageUrl)
  const normalizedFirstFrameUrl = normalizeVideoImageInput(options.firstFrameUrl)
  const normalizedLastFrameUrl = normalizeVideoImageInput(options.lastFrameUrl)

  // 根据输入选择模型 (仅使用支持首尾帧的模型)
  let model = options.model
  if (!model) {
    if (normalizedFirstFrameUrl && normalizedLastFrameUrl) {
      model = VolcengineVideoModels.SEEDANCE_2_0  // 首尾帧模型
    } else if (normalizedImageUrl || normalizedFirstFrameUrl) {
      model = VolcengineVideoModels.SEEDANCE_2_0_FAST  // 图生视频
    } else {
      model = VolcengineVideoModels.SEEDANCE_2_0  // 文生视频默认使用 2.0
    }
  }

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [Volcengine] generateVideo 请求参数:`, {
    model,
    promptLength: options.prompt.length,
    prompt: options.prompt,
    hasImageUrl: !!normalizedImageUrl,
    imageUrlLength: normalizedImageUrl?.length || 0,
    imageUrlKind: resolveImageInputKind(normalizedImageUrl),
    imageUrlPreview: normalizedImageUrl?.slice(0, 40),
    hasFirstFrameUrl: !!normalizedFirstFrameUrl,
    firstFrameUrlLength: normalizedFirstFrameUrl?.length || 0,
    firstFrameUrlKind: resolveImageInputKind(normalizedFirstFrameUrl),
    hasLastFrameUrl: !!normalizedLastFrameUrl,
    lastFrameUrlLength: normalizedLastFrameUrl?.length || 0,
    lastFrameUrlKind: resolveImageInputKind(normalizedLastFrameUrl),
    duration: options.duration,
    size: options.size,
    resolution: options.resolution,
    negativePrompt: options.negativePrompt,
    maxRetries: options.maxRetries
  })

  return withRetry(async () => {
    // 构建 content 数组 (根据官方文档格式)
    const content: Array<{ type: string, text?: string, role?: string, image_url?: { url: string } }> = []
    
    // 添加文本提示
    content.push({
      type: 'text',
      text: options.prompt
    })
    
    // 添加图片 (图生视频模式)
    if (normalizedImageUrl) {
      content.push({
        type: 'image_url',
        role: 'first_frame',
        image_url: { url: normalizedImageUrl }
      })
    }

    // 首尾帧模式: 需要同时传入首帧和尾帧
    if (normalizedFirstFrameUrl && normalizedLastFrameUrl && !normalizedImageUrl) {
      // 首帧
      content.push({
        type: 'image_url',
        role: 'first_frame',
        image_url: { url: normalizedFirstFrameUrl }
      })
      // 尾帧
      content.push({
        type: 'image_url',
        role: 'last_frame',
        image_url: { url: normalizedLastFrameUrl }
      })
    } else if (normalizedFirstFrameUrl && !normalizedImageUrl) {
      // 仅首帧模式
      content.push({
        type: 'image_url',
        role: 'first_frame',
        image_url: { url: normalizedFirstFrameUrl }
      })
    }

    const requestBody: Record<string, unknown> = {
      model,
      content,
      duration: -1,
      watermark: false  // 去掉水印
    }

    // 可选参数
    if (options.duration) {
      requestBody.duration = options.duration
    }
    if (options.resolution) {
      requestBody.resolution = options.resolution
    }

    // 输出请求体摘要 (避免 base64 数据占满控制台)
    const requestSummary = {
      model: requestBody.model,
      contentTypes: content.map(c => c.type),
      textPrompt: content.find(c => c.type === 'text')?.text?.slice(0, 100) + '...',
      hasImages: content.filter(c => c.type === 'image_url').length,
      duration: requestBody.duration,
      resolution: requestBody.resolution
    }
    console.log('[Volcengine] 视频生成请求体摘要:', JSON.stringify(requestSummary, null, 2))

    // 提交视频生成任务 (异步任务 API)
    const submitResponse = await request<CreateTaskResponse>(
      '/contents/generations/tasks',
      requestBody
    )

    const taskId = submitResponse.id
    console.log(`[Volcengine] 视频任务已创建: ${taskId}`)

    // 轮询任务状态
    const maxWaitTime = 600000 // 10分钟
    const pollInterval = 10000
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitTime) {
      await sleep(pollInterval)

      const cfg = getConfig()
      const statusUrl = `${cfg.baseUrl}/contents/generations/tasks/${taskId}`
      
      const statusResponse = await fetch(statusUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json'
        }
      })

      if (!statusResponse.ok) {
        const errorData = await statusResponse.json().catch(() => ({})) as { error?: { message?: string } }
        throw new VolcengineError(
          errorData.error?.message || `HTTP ${statusResponse.status}`,
          VolcengineErrorCode.UNKNOWN,
          statusResponse.status,
          statusResponse.status >= 500
        )
      }

      const statusData = await statusResponse.json() as QueryTaskResponse
      console.log(`[Volcengine] 视频任务状态: ${statusData.status}`, statusData.content ? `video_url: ${statusData.content.video_url?.slice(0, 50)}...` : '')

      if (statusData.status === 'succeeded') {
        const videoUrl = statusData.content?.video_url
        if (!videoUrl) {
          console.error('[Volcengine] 响应数据:', JSON.stringify(statusData, null, 2))
          throw new VolcengineError('视频生成成功但未返回URL', VolcengineErrorCode.INTERNAL, 500, false)
        }
        return { videoUrl, taskId }
      }

      if (statusData.status === 'failed' || statusData.status === 'cancelled' || statusData.status === 'expired') {
        const errorMsg = statusData.error?.message || '视频生成失败'
        throw new VolcengineError(errorMsg, VolcengineErrorCode.INTERNAL, 500, false)
      }
    }

    throw new VolcengineError('视频生成超时', VolcengineErrorCode.DEADLINE_EXCEEDED, 504, false)
  }, { maxRetries: options.maxRetries })
}
