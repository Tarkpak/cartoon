import type { CustomOpenAIProviderConfig } from '#shared/types/provider'
import { withModelDebugLog } from './model-debug-log'

export interface OpenAICompatibleProviderConfig {
  baseUrl: string
  apiKey?: string
}

export class OpenAICompatibleError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryable: boolean = false
  ) {
    super(message)
    this.name = 'OpenAICompatibleError'
  }
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
}

interface ResponsesApiResponse {
  output_text?: string
  output?: Array<{
    content?: Array<{
      text?: string
      type?: string
    }>
  }>
}

interface ModelsResponse {
  data?: Array<{
    id?: string
    object?: string
  }>
}

interface ImageGenerationDataItem {
  url?: string | string[]
  b64_json?: string
  status?: string
  task_id?: string
  taskId?: string
  id?: string
}

interface ImageTaskData {
  id?: string
  status?: string
  task_status?: string
  progress?: number
  result?: {
    images?: Array<{
      url?: string | string[]
      b64_json?: string
    }>
  }
  error?: {
    code?: string | number
    message?: string
  }
  message?: string
}

interface ImageGenerationResponse {
  code?: number
  data?: ImageGenerationDataItem[] | ImageTaskData
  task_id?: string
  status?: string
}

interface ImageTaskStatusResponse {
  code?: number
  status?: string
  data?: ImageTaskData
  message?: string
}

interface RetryConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 16000
}

function resolvePositiveEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

const DEFAULT_IMAGE_TASK_INITIAL_DELAY_MS = resolvePositiveEnvInt('OPENAI_COMPAT_IMAGE_TASK_INITIAL_DELAY_MS', 10000)
const DEFAULT_IMAGE_TASK_POLL_INTERVAL_MS = resolvePositiveEnvInt('OPENAI_COMPAT_IMAGE_TASK_POLL_INTERVAL_MS', 4000)
const DEFAULT_IMAGE_TASK_TIMEOUT_MS = resolvePositiveEnvInt('OPENAI_COMPAT_IMAGE_TASK_TIMEOUT_MS', 600000)
const APIMART_GPT_IMAGE_2_MODEL = 'gpt-image-2'
const APIMART_GPT_IMAGE_2_OFFICIAL_MODEL = 'gpt-image-2-official'
const APIMART_IMAGE_RESOLUTIONS = new Set(['1k', '2k', '4k'])
const OPENAI_IMAGE_QUALITIES = new Set(['auto', 'low', 'medium', 'high'])
const APIMART_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '5:4',
  '4:5',
  '16:9',
  '9:16',
  '2:1',
  '1:2',
  '21:9',
  '9:21'
] as const
const APIMART_IMAGE_ASPECT_RATIO_VALUES: Record<typeof APIMART_IMAGE_ASPECT_RATIOS[number], number> = {
  '1:1': 1,
  '3:2': 1.5,
  '2:3': 2 / 3,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '5:4': 1.25,
  '4:5': 4 / 5,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '2:1': 2,
  '1:2': 0.5,
  '21:9': 21 / 9,
  '9:21': 9 / 21
}
const APIMART_IMAGE_ASPECT_RATIO_ALIASES: Record<string, string> = {
  '1:1': '1:1',
  '3:2': '3:2',
  '2:3': '2:3',
  '4:3': '4:3',
  '3:4': '3:4',
  '5:4': '5:4',
  '4:5': '4:5',
  '16:9': '16:9',
  '9:16': '9:16',
  '2:1': '2:1',
  '1:2': '1:2',
  '21:9': '21:9',
  '9:21': '9:21',
  '7:3': '21:9',
  '3:7': '9:21'
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y !== 0) {
    const temp = y
    y = x % y
    x = temp
  }
  return x || 1
}

function normalizeOpenAIQuality(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  return OPENAI_IMAGE_QUALITIES.has(normalized) ? normalized : undefined
}

function normalizeApiMartResolution(value?: string): '1k' | '2k' | '4k' | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  if (APIMART_IMAGE_RESOLUTIONS.has(normalized)) {
    return normalized as '1k' | '2k' | '4k'
  }
  if (normalized === 'medium') return '2k'
  if (normalized === 'high') return '4k'
  if (normalized === 'auto' || normalized === 'low') return '1k'
  return undefined
}

function normalizeApiMartAspectRatio(value?: string): string | undefined {
  const normalized = value?.replace(/\s+/g, '').toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'auto') return 'auto'
  const matched = normalized.match(/^(\d+):(\d+)$/)
  if (!matched) return undefined

  const width = Number(matched[1])
  const height = Number(matched[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }

  const divisor = gcd(width, height)
  const reduced = `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
  return APIMART_IMAGE_ASPECT_RATIO_ALIASES[reduced]
}

function parseImageSize(size?: string): { width: number, height: number } | null {
  const normalized = size?.replace(/\s+/g, '').toLowerCase()
  if (!normalized) return null
  const matched = normalized.match(/^(\d+)[x*](\d+)$/)
  if (!matched) return null

  const width = Number(matched[1])
  const height = Number(matched[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function resolveNearestApiMartAspectRatio(width: number, height: number): string {
  const target = width / height
  let closest = '1:1'
  let minDiff = Number.POSITIVE_INFINITY

  for (const ratio of APIMART_IMAGE_ASPECT_RATIOS) {
    const value = APIMART_IMAGE_ASPECT_RATIO_VALUES[ratio]
    const diff = Math.abs(Math.log(target / value))
    if (diff < minDiff) {
      minDiff = diff
      closest = ratio
    }
  }

  return closest
}

function resolveApiMartImageSize(options: { aspectRatio?: string, size?: string }): string {
  const aspectFromOption = normalizeApiMartAspectRatio(options.aspectRatio)
  if (aspectFromOption) return aspectFromOption

  const sizeInput = options.size?.replace(/\*/g, 'x')
  const aspectFromSizeToken = normalizeApiMartAspectRatio(sizeInput)
  if (aspectFromSizeToken) return aspectFromSizeToken

  const parsedSize = parseImageSize(sizeInput)
  if (!parsedSize) return '1:1'

  const exactAspect = normalizeApiMartAspectRatio(`${parsedSize.width}:${parsedSize.height}`)
  if (exactAspect) return exactAspect

  return resolveNearestApiMartAspectRatio(parsedSize.width, parsedSize.height)
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function chatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/chat/completions')) {
    return normalized
  }
  return `${normalized}/chat/completions`
}

function responsesUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/responses')) {
    return normalized
  }
  if (normalized.endsWith('/chat/completions')) {
    return `${normalized.slice(0, -'/chat/completions'.length)}/responses`
  }
  if (normalized.endsWith('/models')) {
    return `${normalized.slice(0, -'/models'.length)}/responses`
  }
  return `${normalized}/responses`
}

function isResponsesEndpoint(baseUrl: string): boolean {
  return normalizeBaseUrl(baseUrl).endsWith('/responses')
}

function shouldUseResponsesApi(baseUrl: string, model: string): boolean {
  return isResponsesEndpoint(baseUrl) || model.trim().toLowerCase().startsWith('gpt-5')
}

function modelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/models')) {
    return normalized
  }
  if (normalized.endsWith('/responses')) {
    return `${normalized.slice(0, -'/responses'.length)}/models`
  }
  if (normalized.endsWith('/chat/completions')) {
    return `${normalized.slice(0, -'/chat/completions'.length)}/models`
  }
  return `${normalized}/models`
}

function imageGenerationsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/images/generations')) {
    return normalized
  }
  if (normalized.endsWith('/chat/completions')) {
    return `${normalized.slice(0, -'/chat/completions'.length)}/images/generations`
  }
  if (normalized.endsWith('/responses')) {
    return `${normalized.slice(0, -'/responses'.length)}/images/generations`
  }
  if (normalized.endsWith('/models')) {
    return `${normalized.slice(0, -'/models'.length)}/images/generations`
  }
  return `${normalized}/images/generations`
}

function imageEditsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/images/edits')) {
    return normalized
  }
  if (normalized.endsWith('/chat/completions')) {
    return `${normalized.slice(0, -'/chat/completions'.length)}/images/edits`
  }
  if (normalized.endsWith('/responses')) {
    return `${normalized.slice(0, -'/responses'.length)}/images/edits`
  }
  if (normalized.endsWith('/models')) {
    return `${normalized.slice(0, -'/models'.length)}/images/edits`
  }
  return `${normalized}/images/edits`
}

function taskStatusUrl(baseUrl: string, taskId: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const encodedTaskId = encodeURIComponent(taskId.trim())
  const mappedSuffixes = [
    '/images/generations',
    '/images/edits',
    '/chat/completions',
    '/responses',
    '/models'
  ]

  for (const suffix of mappedSuffixes) {
    if (normalized.endsWith(suffix)) {
      return `${normalized.slice(0, -suffix.length)}/tasks/${encodedTaskId}`
    }
  }

  const taskPathMatch = normalized.match(/\/tasks\/[^/]+$/)
  if (taskPathMatch) {
    return `${normalized.slice(0, -taskPathMatch[0].length)}/tasks/${encodedTaskId}`
  }
  if (normalized.endsWith('/tasks')) {
    return `${normalized}/${encodedTaskId}`
  }
  return `${normalized}/tasks/${encodedTaskId}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function delayForAttempt(attempt: number, config: RetryConfig): number {
  return Math.min(config.initialDelayMs * Math.pow(2, attempt), config.maxDelayMs)
}

function parseError(error: unknown): OpenAICompatibleError {
  if (error instanceof OpenAICompatibleError) return error

  const err = error as { status?: number, message?: string }
  const status = err.status || 500
  return new OpenAICompatibleError(
    err.message || 'OpenAI 兼容接口请求失败',
    status,
    status >= 500 || status === 429
  )
}

function getAuthorizationHeader(providerConfig: OpenAICompatibleProviderConfig): string {
  const authorization = providerConfig.apiKey ?? ''
  if (!authorization) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 API Key', 403, false)
  }
  return authorization
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retryConfig: Partial<RetryConfig> = {}
): Promise<T> {
  const config: RetryConfig = {
    maxRetries: retryConfig.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
    initialDelayMs: retryConfig.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs,
    maxDelayMs: retryConfig.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs
  }
  let lastError = new OpenAICompatibleError('OpenAI 兼容接口请求失败')

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = parseError(error)
      if (!lastError.retryable || attempt === config.maxRetries) {
        throw lastError
      }
      await sleep(delayForAttempt(attempt, config))
    }
  }

  throw lastError
}

async function requestChatCompletion<T>(
  providerConfig: OpenAICompatibleProviderConfig,
  body: Record<string, unknown>
): Promise<T> {
  const authorization = getAuthorizationHeader(providerConfig)
  const baseUrl = providerConfig.baseUrl?.trim()

  if (!baseUrl) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 Base URL', 400, false)
  }
  const response = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string }, message?: string }
    throw new OpenAICompatibleError(
      errorData.error?.message || errorData.message || `HTTP ${response.status}`,
      response.status,
      response.status >= 500 || response.status === 429
    )
  }

  return await response.json() as T
}

async function requestResponses<T>(
  providerConfig: OpenAICompatibleProviderConfig,
  body: Record<string, unknown>
): Promise<T> {
  const authorization = getAuthorizationHeader(providerConfig)
  const baseUrl = providerConfig.baseUrl?.trim()

  if (!baseUrl) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 Base URL', 400, false)
  }
  const response = await fetch(responsesUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string }, message?: string }
    throw new OpenAICompatibleError(
      errorData.error?.message || errorData.message || `HTTP ${response.status}`,
      response.status,
      response.status >= 500 || response.status === 429
    )
  }

  return await response.json() as T
}

async function requestImageGeneration<T>(
  providerConfig: OpenAICompatibleProviderConfig,
  body: Record<string, unknown>
): Promise<T> {
  const authorization = getAuthorizationHeader(providerConfig)
  const baseUrl = providerConfig.baseUrl?.trim()

  if (!baseUrl) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 Base URL', 400, false)
  }
  const response = await fetch(imageGenerationsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string }, message?: string }
    throw new OpenAICompatibleError(
      errorData.error?.message || errorData.message || `HTTP ${response.status}`,
      response.status,
      response.status >= 500 || response.status === 429
    )
  }

  return await response.json() as T
}

async function requestImageEdit<T>(
  providerConfig: OpenAICompatibleProviderConfig,
  body: FormData
): Promise<T> {
  const authorization = getAuthorizationHeader(providerConfig)
  const baseUrl = providerConfig.baseUrl?.trim()

  if (!baseUrl) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 Base URL', 400, false)
  }
  const response = await fetch(imageEditsUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: authorization
    },
    body
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string }, message?: string }
    throw new OpenAICompatibleError(
      errorData.error?.message || errorData.message || `HTTP ${response.status}`,
      response.status,
      response.status >= 500 || response.status === 429
    )
  }

  return await response.json() as T
}

async function requestImageTaskStatus<T>(
  providerConfig: OpenAICompatibleProviderConfig,
  taskId: string
): Promise<T> {
  const authorization = getAuthorizationHeader(providerConfig)
  const baseUrl = providerConfig.baseUrl?.trim()

  if (!baseUrl) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 Base URL', 400, false)
  }
  const response = await fetch(taskStatusUrl(baseUrl, taskId), {
    method: 'GET',
    headers: {
      Authorization: authorization
    }
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string }, message?: string }
    throw new OpenAICompatibleError(
      errorData.error?.message || errorData.message || `HTTP ${response.status}`,
      response.status,
      response.status >= 500 || response.status === 429
    )
  }

  return await response.json() as T
}

function parseDataUri(value: string): { mimeType: string, data: string } | null {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (!match?.[1] || !match[2]) return null
  return {
    mimeType: match[1],
    data: match[2].replace(/\s+/g, '')
  }
}

function normalizeImageMimeType(value?: string | null): string | null {
  const normalized = (value || '').split(';')[0]?.trim().toLowerCase()
  if (!normalized?.startsWith('image/')) return null
  return normalized
}

function extensionByMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/bmp':
      return 'bmp'
    case 'image/png':
    default:
      return 'png'
  }
}

async function toImageFilePart(reference: string, index: number): Promise<{ blob: Blob, filename: string }> {
  const trimmed = reference.trim()
  if (!trimmed) {
    throw new OpenAICompatibleError('参考图不能为空', 400, false)
  }

  const dataUri = parseDataUri(trimmed)
  if (dataUri) {
    const bytes = Buffer.from(dataUri.data, 'base64')
    if (!bytes.length) {
      throw new OpenAICompatibleError('参考图 base64 数据为空', 400, false)
    }
    const mimeType = normalizeImageMimeType(dataUri.mimeType) || 'image/png'
    return {
      blob: new Blob([bytes], { type: mimeType }),
      filename: `reference-${index}.${extensionByMimeType(mimeType)}`
    }
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const response = await fetch(trimmed)
    if (!response.ok) {
      throw new OpenAICompatibleError(`下载参考图失败: HTTP ${response.status}`, response.status, false)
    }
    const mimeType = normalizeImageMimeType(response.headers.get('content-type')) || 'image/png'
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length) {
      throw new OpenAICompatibleError('参考图下载结果为空', 400, false)
    }
    return {
      blob: new Blob([bytes], { type: mimeType }),
      filename: `reference-${index}.${extensionByMimeType(mimeType)}`
    }
  }

  const compact = trimmed.replace(/\s+/g, '')
  const bytes = Buffer.from(compact, 'base64')
  if (!bytes.length) {
    throw new OpenAICompatibleError('参考图格式无效，请提供 URL 或 base64 数据', 400, false)
  }

  return {
    blob: new Blob([bytes], { type: 'image/png' }),
    filename: `reference-${index}.png`
  }
}

function pickFirstString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = pickFirstString(item)
      if (resolved) return resolved
    }
  }
  return undefined
}

function extractImageResultFromItem(item: unknown): { imageUrl?: string, imageData?: string, mimeType?: string } | null {
  if (!item || typeof item !== 'object') return null
  const record = item as { url?: unknown, b64_json?: unknown }
  const imageUrl = pickFirstString(record.url)
  if (imageUrl) {
    return { imageUrl }
  }
  const imageData = pickFirstString(record.b64_json)
  if (imageData) {
    return { imageData, mimeType: 'image/png' }
  }
  return null
}

function extractImageResultFromResponse(
  response: ImageGenerationResponse | ImageTaskStatusResponse
): { imageUrl?: string, imageData?: string, mimeType?: string } | null {
  const data = response.data
  if (Array.isArray(data)) {
    for (const item of data) {
      const extracted = extractImageResultFromItem(item)
      if (extracted) return extracted
    }
    return null
  }

  if (data && typeof data === 'object') {
    const taskData = data as ImageTaskData
    const images = taskData.result?.images
    if (Array.isArray(images)) {
      for (const image of images) {
        const extracted = extractImageResultFromItem(image)
        if (extracted) return extracted
      }
    }
    return extractImageResultFromItem(taskData)
  }

  return extractImageResultFromItem(response as unknown)
}

function extractTaskIdFromImageResponse(response: ImageGenerationResponse): string | null {
  if (Array.isArray(response.data)) {
    for (const item of response.data) {
      const taskId = pickFirstString(item?.task_id) || pickFirstString(item?.taskId) || pickFirstString(item?.id)
      if (taskId) return taskId
    }
  } else if (response.data && typeof response.data === 'object') {
    const taskData = response.data as ImageTaskData & { task_id?: string, taskId?: string }
    const taskId = pickFirstString(taskData.id) || pickFirstString(taskData.task_id) || pickFirstString(taskData.taskId)
    if (taskId) return taskId
  }

  return pickFirstString(response.task_id) || null
}

function normalizeTaskStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isTaskSuccessStatus(status: string): boolean {
  return status === 'completed'
    || status === 'succeeded'
    || status === 'succeed'
    || status === 'success'
    || status === 'done'
    || status === 'finished'
}

function isTaskFailedStatus(status: string): boolean {
  return status === 'failed'
    || status === 'cancelled'
    || status === 'canceled'
    || status === 'error'
    || status === 'rejected'
    || status === 'expired'
}

function taskErrorMessage(response: ImageTaskStatusResponse): string {
  return response.data?.error?.message
    || response.data?.message
    || response.message
    || '图片生成任务失败'
}

async function resolveImageTaskResult(options: {
  providerConfig: CustomOpenAIProviderConfig
  taskId: string
}): Promise<{ imageUrl?: string, imageData?: string, mimeType?: string }> {
  await sleep(DEFAULT_IMAGE_TASK_INITIAL_DELAY_MS)

  const startedAt = Date.now()
  let lastStatus = ''
  let lastProgress: number | undefined
  while (Date.now() - startedAt < DEFAULT_IMAGE_TASK_TIMEOUT_MS) {
    const taskResponse = await requestImageTaskStatus<ImageTaskStatusResponse>(
      options.providerConfig,
      options.taskId
    )
    const status = normalizeTaskStatus(
      taskResponse.data?.status
      || taskResponse.data?.task_status
      || taskResponse.status
    )
    lastStatus = status
    lastProgress = typeof taskResponse.data?.progress === 'number'
      ? taskResponse.data.progress
      : lastProgress
    console.log('[OpenAI Compatible] Image Task Status:', {
      taskId: options.taskId,
      status,
      progress: taskResponse.data?.progress
    })

    // 有些兼容提供商状态字段不稳定，只要拿到图片就直接返回
    const imageResult = extractImageResultFromResponse(taskResponse)
    if (imageResult?.imageUrl || imageResult?.imageData) {
      return imageResult
    }

    if (isTaskSuccessStatus(status)) {
      throw new OpenAICompatibleError('图片任务已完成但未返回图片 URL 或 base64', 500, false)
    }

    if (isTaskFailedStatus(status)) {
      throw new OpenAICompatibleError(taskErrorMessage(taskResponse), 500, false)
    }

    await sleep(DEFAULT_IMAGE_TASK_POLL_INTERVAL_MS)
  }

  const timeoutDetails = [
    `taskId=${options.taskId}`,
    `status=${lastStatus || 'unknown'}`,
    `progress=${typeof lastProgress === 'number' ? String(lastProgress) : 'n/a'}`
  ].join(', ')
  throw new OpenAICompatibleError(`图片任务查询超时（${timeoutDetails}）`, 504, false)
}

export async function listOpenAICompatibleModels(
  providerConfig: OpenAICompatibleProviderConfig
): Promise<string[]> {
  const authorization = getAuthorizationHeader(providerConfig)
  const baseUrl = providerConfig.baseUrl?.trim()

  if (!baseUrl) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 Base URL', 400, false)
  }
  const response = await fetch(modelsUrl(baseUrl), {
    method: 'GET',
    headers: {
      Authorization: authorization
    }
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string }, message?: string }
    throw new OpenAICompatibleError(
      errorData.error?.message || errorData.message || `HTTP ${response.status}`,
      response.status,
      response.status >= 500 || response.status === 429
    )
  }

  const result = await response.json() as ModelsResponse
  return Array.from(new Set(
    (result.data || [])
      .map(model => typeof model.id === 'string' ? model.id.trim() : '')
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b))
}

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
    if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return null
}

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
    if (char === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return null
}

function parseJsonFromModelText<T>(text: string): T {
  let jsonText = text.trim()
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (codeBlockMatch?.[1]) {
    jsonText = codeBlockMatch[1].trim()
  } else {
    try {
      JSON.parse(jsonText)
    } catch {
      jsonText = extractJsonObject(text) || extractJsonArray(text) || jsonText
    }
  }

  return JSON.parse(jsonText) as T
}

function buildResponsesInput(prompt: string, systemInstruction?: string): string {
  if (!systemInstruction) return prompt
  return `${systemInstruction}\n\n${prompt}`
}

function extractResponsesText(response: ResponsesApiResponse): string {
  if (response.output_text) return response.output_text

  return (response.output || [])
    .flatMap(item => item.content || [])
    .map(content => content.text || '')
    .filter(Boolean)
    .join('\n')
}

export async function generateOpenAICompatibleText(options: {
  providerConfig: CustomOpenAIProviderConfig
  model: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<string> {
  const messages: Array<{ role: string, content: string }> = []
  if (options.systemInstruction) {
    messages.push({ role: 'system', content: options.systemInstruction })
  }
  messages.push({ role: 'user', content: options.prompt })

  const chatRequestBody = {
    model: options.model,
    messages,
    temperature: options.temperature ?? 0.7
  }
  const responsesRequestBody = {
    model: options.model,
    input: buildResponsesInput(options.prompt, options.systemInstruction)
  }
  const useResponses = shouldUseResponsesApi(options.providerConfig.baseUrl, options.model)
  const requestBody = useResponses ? responsesRequestBody : chatRequestBody

  return withModelDebugLog({
    provider: 'custom_openai',
    model: options.model,
    operation: 'generateText',
    request: requestBody,
    summarizeResponse: text => ({ text, textLength: text.length }),
    execute: async () => withRetry(async () => {
      if (useResponses) {
        const response = await requestResponses<ResponsesApiResponse>(
          options.providerConfig,
          responsesRequestBody
        )
        return extractResponsesText(response)
      }

      const response = await requestChatCompletion<ChatCompletionResponse>(
        options.providerConfig,
        chatRequestBody
      )
      return response.choices?.[0]?.message?.content || ''
    }, { maxRetries: options.maxRetries })
  })
}

export async function generateOpenAICompatibleJSON<T>(options: {
  providerConfig: CustomOpenAIProviderConfig
  model: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<T> {
  const messages: Array<{ role: string, content: string }> = []
  if (options.systemInstruction) {
    messages.push({ role: 'system', content: options.systemInstruction })
  }
  messages.push({ role: 'user', content: options.prompt })

  const chatRequestBody = {
    model: options.model,
    messages,
    temperature: options.temperature ?? 0.2,
    response_format: { type: 'json_object' as const }
  }
  const responsesRequestBody = {
    model: options.model,
    input: buildResponsesInput(`${options.prompt}\n\nReturn only valid JSON.`, options.systemInstruction)
  }
  const useResponses = shouldUseResponsesApi(options.providerConfig.baseUrl, options.model)
  const requestBody = useResponses ? responsesRequestBody : chatRequestBody

  return withModelDebugLog({
    provider: 'custom_openai',
    model: options.model,
    operation: 'generateJSON',
    request: requestBody,
    execute: async () => withRetry(async () => {
      if (useResponses) {
        const response = await requestResponses<ResponsesApiResponse>(
          options.providerConfig,
          responsesRequestBody
        )
        return parseJsonFromModelText<T>(extractResponsesText(response) || '{}')
      }

      const response = await requestChatCompletion<ChatCompletionResponse>(
        options.providerConfig,
        chatRequestBody
      )
      return parseJsonFromModelText<T>(response.choices?.[0]?.message?.content || '{}')
    }, { maxRetries: options.maxRetries })
  })
}

export async function generateOpenAICompatibleImage(options: {
  providerConfig: CustomOpenAIProviderConfig
  model: string
  prompt: string
  size?: string
  aspectRatio?: string
  quality?: string
  referenceImages?: string[]
  maxRetries?: number
}): Promise<{ imageUrl?: string, imageData?: string, mimeType?: string }> {
  const normalizedModel = options.model.trim().toLowerCase()
  const isApiMartGptImage2 = normalizedModel === APIMART_GPT_IMAGE_2_MODEL
  const isApiMartGptImage2Official = normalizedModel === APIMART_GPT_IMAGE_2_OFFICIAL_MODEL
  const isApiMartGptImage2Series = isApiMartGptImage2 || isApiMartGptImage2Official
  const supportsQuality = normalizedModel.startsWith('gpt-image') && !isApiMartGptImage2
  const supportsEdit = normalizedModel.startsWith('gpt-image')
  const useImageUrlsInGenerations = isApiMartGptImage2Series
  const referenceImages = (options.referenceImages || [])
    .map(image => image.trim())
    .filter(Boolean)
  const normalizedQuality = normalizeOpenAIQuality(options.quality)
  const quality = supportsQuality ? normalizedQuality : undefined
  const normalizedQualityOrResolution = options.quality?.trim().toLowerCase()
  const explicitResolution = normalizedQualityOrResolution && APIMART_IMAGE_RESOLUTIONS.has(normalizedQualityOrResolution)
    ? normalizedQualityOrResolution as '1k' | '2k' | '4k'
    : undefined
  const resolution = isApiMartGptImage2
    ? normalizeApiMartResolution(options.quality)
    : explicitResolution
  const resolvedSize = isApiMartGptImage2Series
    ? resolveApiMartImageSize({ aspectRatio: options.aspectRatio, size: options.size })
    : (options.size?.replace(/\*/g, 'x') || '1024x1024')

  const requestBody: Record<string, unknown> = {
    model: options.model,
    prompt: options.prompt,
    size: resolvedSize,
    n: 1
  }
  if (quality) {
    requestBody.quality = quality
  }
  if (resolution) {
    requestBody.resolution = resolution
  }
  if (referenceImages.length > 0 && useImageUrlsInGenerations) {
    requestBody.image_urls = referenceImages
  }

  if (referenceImages.length > 0 && !supportsEdit) {
    throw new OpenAICompatibleError(`模型 ${options.model} 不支持参考图编辑`, 400, false)
  }

  return withModelDebugLog({
    provider: 'custom_openai',
    model: options.model,
    operation: 'generateImage',
    request: {
      ...requestBody,
      referenceImageCount: referenceImages.length
    },
    summarizeResponse: result => ({
      hasImageUrl: !!result.imageUrl,
      imageUrlPreview: result.imageUrl?.slice(0, 100),
      hasImageData: !!result.imageData,
      imageDataLength: result.imageData?.length || 0,
      mimeType: result.mimeType
    }),
    execute: async () => withRetry(async () => {
      const response = referenceImages.length > 0 && !useImageUrlsInGenerations
        ? await (async () => {
            const formData = new FormData()
            formData.set('model', options.model)
            formData.set('prompt', options.prompt)
            formData.set('size', requestBody.size as string)
            formData.set('n', String(requestBody.n))
            if (quality) {
              formData.set('quality', quality)
            }
            for (let i = 0; i < referenceImages.length; i++) {
              const reference = referenceImages[i]
              if (!reference) continue
              const part = await toImageFilePart(reference, i)
              formData.append('image[]', part.blob, part.filename)
            }
            return await requestImageEdit<ImageGenerationResponse>(
              options.providerConfig,
              formData
            )
          })()
        : await requestImageGeneration<ImageGenerationResponse>(
            options.providerConfig,
            requestBody
          )
      console.log('OpenAI Compatible Image Generation Response:', response)

      const immediateResult = extractImageResultFromResponse(response)
      if (immediateResult?.imageUrl || immediateResult?.imageData) {
        return immediateResult
      }

      const taskId = extractTaskIdFromImageResponse(response)
      if (taskId) {
        return await resolveImageTaskResult({
          providerConfig: options.providerConfig,
          taskId
        })
      }

      throw new OpenAICompatibleError('OpenAI 兼容图片生成未返回图片 URL 或 base64', 500, false)
    }, { maxRetries: options.maxRetries })
  })
}
