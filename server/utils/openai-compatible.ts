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

function modelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/models')) {
    return normalized
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
  if (normalized.endsWith('/models')) {
    return `${normalized.slice(0, -'/models'.length)}/images/generations`
  }
  return `${normalized}/images/generations`
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

async function withRetry<T>(
  fn: () => Promise<T>,
  retryConfig: Partial<RetryConfig> = {}
): Promise<T> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
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
  const apiKey = providerConfig.apiKey?.trim()
  const baseUrl = providerConfig.baseUrl?.trim()

  if (!baseUrl) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 Base URL', 400, false)
  }
  if (!apiKey) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 API Key', 403, false)
  }

  const response = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
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
  const apiKey = providerConfig.apiKey?.trim()
  const baseUrl = providerConfig.baseUrl?.trim()

  if (!baseUrl) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 Base URL', 400, false)
  }
  if (!apiKey) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 API Key', 403, false)
  }

  const response = await fetch(imageGenerationsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
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

export async function listOpenAICompatibleModels(
  providerConfig: OpenAICompatibleProviderConfig
): Promise<string[]> {
  const apiKey = providerConfig.apiKey?.trim()
  const baseUrl = providerConfig.baseUrl?.trim()

  if (!baseUrl) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 Base URL', 400, false)
  }
  if (!apiKey) {
    throw new OpenAICompatibleError('自定义 OpenAI 兼容供应商缺少 API Key', 403, false)
  }

  const response = await fetch(modelsUrl(baseUrl), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`
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

  const requestBody = {
    model: options.model,
    messages,
    temperature: options.temperature ?? 0.7
  }

  return withModelDebugLog({
    provider: 'custom_openai',
    model: options.model,
    operation: 'generateText',
    request: requestBody,
    summarizeResponse: text => ({ text, textLength: text.length }),
    execute: async () => withRetry(async () => {
      const response = await requestChatCompletion<ChatCompletionResponse>(
        options.providerConfig,
        requestBody
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

  const requestBody = {
    model: options.model,
    messages,
    temperature: options.temperature ?? 0.2,
    response_format: { type: 'json_object' as const }
  }

  return withModelDebugLog({
    provider: 'custom_openai',
    model: options.model,
    operation: 'generateJSON',
    request: requestBody,
    execute: async () => withRetry(async () => {
      const response = await requestChatCompletion<ChatCompletionResponse>(
        options.providerConfig,
        requestBody
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
  maxRetries?: number
}): Promise<{ imageUrl?: string, imageData?: string, mimeType?: string }> {
  const requestBody = {
    model: options.model,
    prompt: options.prompt,
    size: options.size?.replace('*', 'x') || '1024x1024',
    n: 1
  }

  return withModelDebugLog({
    provider: 'custom_openai',
    model: options.model,
    operation: 'generateImage',
    request: requestBody,
    summarizeResponse: result => ({
      hasImageUrl: !!result.imageUrl,
      imageUrlPreview: result.imageUrl?.slice(0, 100),
      hasImageData: !!result.imageData,
      imageDataLength: result.imageData?.length || 0,
      mimeType: result.mimeType
    }),
    execute: async () => withRetry(async () => {
      const response = await requestImageGeneration<ImageGenerationResponse>(
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
