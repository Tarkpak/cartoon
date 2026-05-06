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

interface ImageGenerationResponse {
  data?: Array<{
    url?: string
    b64_json?: string
  }>
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
      'Authorization': authorization
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
  quality?: string
  referenceImages?: string[]
  maxRetries?: number
}): Promise<{ imageUrl?: string, imageData?: string, mimeType?: string }> {
  const normalizedModel = options.model.trim().toLowerCase()
  const normalizedQuality = options.quality?.trim().toLowerCase()
  const supportsQuality = normalizedModel.startsWith('gpt-image')
  const supportsEdit = normalizedModel.startsWith('gpt-image')
  const referenceImages = (options.referenceImages || [])
    .map(image => image.trim())
    .filter(Boolean)
  const validQualities = new Set(['auto', 'low', 'medium', 'high'])
  const quality = supportsQuality && normalizedQuality && validQualities.has(normalizedQuality)
    ? normalizedQuality
    : undefined

  const requestBody: Record<string, unknown> = {
    model: options.model,
    prompt: options.prompt,
    size: options.size?.replace(/\*/g, 'x') || '1024x1024',
    n: 1
  }
  if (quality) {
    requestBody.quality = quality
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
      const response = referenceImages.length > 0
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
      const first = response.data?.[0]
      if (first?.url) {
        return { imageUrl: first.url }
      }
      if (first?.b64_json) {
        return {
          imageData: first.b64_json,
          mimeType: 'image/png'
        }
      }
      throw new OpenAICompatibleError('OpenAI 兼容图片生成未返回图片 URL 或 base64', 500, false)
    }, { maxRetries: options.maxRetries })
  })
}
