import { ofetch } from 'ofetch'
import type { App } from 'vue'

const REQUEST_ID_HEADER = 'x-request-id'
const LOG_ENDPOINT = '/api/debug/app-logs'
const LOG_TEXT_LIMIT = 16 * 1024

type FrontendLogLevel = 'debug' | 'info' | 'warn' | 'error'

interface FrontendLogInput {
  level: FrontendLogLevel
  category: string
  message: string
  requestId?: string
  method?: string
  path?: string
  status?: number
  durationMs?: number
  metadata?: Record<string, unknown>
  error?: unknown
}

function isClientRuntime() {
  return typeof window !== 'undefined' && typeof fetch === 'function'
}

export function createRequestId() {
  const randomId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
  return `req_${randomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`
}

function truncateText(value: string, maxChars = LOG_TEXT_LIMIT) {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...`
}

function normalizeUrl(input: RequestInfo | URL | string): URL | null {
  try {
    if (typeof input === 'string') {
      return new URL(input, globalThis.location?.origin || 'http://127.0.0.1')
    }
    if (input instanceof URL) {
      return input
    }
    return new URL(input.url, globalThis.location?.origin || 'http://127.0.0.1')
  } catch {
    return null
  }
}

function apiPath(input: RequestInfo | URL | string): string {
  const url = normalizeUrl(input)
  if (!url) return typeof input === 'string' ? input : ''
  return `${url.pathname}${url.search ? '?...' : ''}`
}

function isApiRequest(input: RequestInfo | URL | string) {
  const url = normalizeUrl(input)
  return url?.pathname.startsWith('/api') === true
}

function headersWithRequestId(headers: HeadersInit | undefined, requestId: string) {
  const nextHeaders = new Headers(headers)
  nextHeaders.set(REQUEST_ID_HEADER, requestId)
  return nextHeaders
}

function requestIdFromHeaders(headers: HeadersInit | undefined): string | undefined {
  if (!headers) return undefined
  try {
    return new Headers(headers).get(REQUEST_ID_HEADER) || undefined
  } catch {
    return undefined
  }
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncateText(error.message),
      stack: error.stack ? truncateText(error.stack, 32 * 1024) : undefined
    }
  }
  if (typeof error === 'string') {
    return { message: truncateText(error) }
  }
  return { message: truncateText(String(error)) }
}

async function readErrorPayload(response: Response) {
  const contentType = response.headers.get('content-type') || ''
  try {
    if (contentType.includes('application/json')) {
      return await response.json()
    }
    const text = await response.text()
    return text ? truncateText(text) : undefined
  } catch {
    return undefined
  }
}

export function recordFrontendLog(input: FrontendLogInput) {
  if (!isClientRuntime()) return

  const requestId = input.requestId || createRequestId()
  const payload = {
    level: input.level,
    source: 'frontend',
    category: input.category,
    message: truncateText(input.message || input.category),
    requestId,
    method: input.method,
    path: input.path,
    status: input.status,
    durationMs: input.durationMs,
    metadata: input.metadata,
    error: input.error === undefined ? undefined : normalizeError(input.error)
  }
  const body = JSON.stringify(payload)

  void fetch(LOG_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [REQUEST_ID_HEADER]: requestId
    },
    body,
    keepalive: body.length < 60_000
  }).catch(() => {
    // Logging must never create another user-visible failure.
  })
}

export async function observedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  if (!isApiRequest(input)) {
    return await fetch(input, init)
  }

  const requestId = requestIdFromHeaders(init.headers) || createRequestId()
  const method = (init.method || 'GET').toUpperCase()
  const path = apiPath(input)
  const startedAt = performance.now()
  const nextInit: RequestInit = {
    ...init,
    headers: headersWithRequestId(init.headers, requestId)
  }

  try {
    const response = await fetch(input, nextInit)
    const responseRequestId = response.headers.get(REQUEST_ID_HEADER) || requestId
    if (!response.ok) {
      const payload = await readErrorPayload(response.clone())
      recordFrontendLog({
        level: response.status >= 500 ? 'error' : 'warn',
        category: 'api_response_error',
        message: `${method} ${path} -> ${response.status}`,
        requestId: responseRequestId,
        method,
        path,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        metadata: { response: payload }
      })
    }
    return response
  } catch (error) {
    recordFrontendLog({
      level: 'error',
      category: 'api_request_error',
      message: `${method} ${path} 请求失败`,
      requestId,
      method,
      path,
      durationMs: Math.round(performance.now() - startedAt),
      error
    })
    throw error
  }
}

export const $fetch = ofetch.create({
  onRequest({ request, options }) {
    if (!isApiRequest(request)) return
    const requestId = requestIdFromHeaders(options.headers) || createRequestId()
    options.headers = headersWithRequestId(options.headers, requestId)
  },
  onRequestError({ request, options, error }) {
    if (!isApiRequest(request)) return
    const method = String(options.method || 'GET').toUpperCase()
    const path = apiPath(request)
    recordFrontendLog({
      level: 'error',
      category: 'api_request_error',
      message: `${method} ${path} 请求失败`,
      requestId: requestIdFromHeaders(options.headers),
      method,
      path,
      error
    })
  },
  onResponseError({ request, options, response }) {
    if (!isApiRequest(request)) return
    const method = String(options.method || 'GET').toUpperCase()
    const path = apiPath(request)
    recordFrontendLog({
      level: response.status >= 500 ? 'error' : 'warn',
      category: 'api_response_error',
      message: `${method} ${path} -> ${response.status}`,
      requestId: response.headers.get(REQUEST_ID_HEADER) || requestIdFromHeaders(options.headers),
      method,
      path,
      status: response.status,
      metadata: { response: response._data }
    })
  }
})

export function installFrontendObservability(app: App) {
  app.config.errorHandler = (error, instance, info) => {
    const componentName = instance?.$options?.name
    // 设置 errorHandler 会接管 Vue 默认的控制台打印；开发期仍输出一份，避免在 devtools 丢失现场。
    if (import.meta.env.DEV) {
      console.error(`[vue_error] ${info}`, error)
    }
    recordFrontendLog({
      level: 'error',
      category: 'vue_error',
      message: error instanceof Error ? error.message : String(error),
      metadata: {
        info,
        componentName,
        route: isClientRuntime() ? window.location.pathname : undefined
      },
      error
    })
  }

  if (!isClientRuntime()) return

  window.addEventListener('error', (event) => {
    recordFrontendLog({
      level: 'error',
      category: 'window_error',
      message: event.message || 'window error',
      metadata: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        route: window.location.pathname
      },
      error: event.error || event.message
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    recordFrontendLog({
      level: 'error',
      category: 'unhandled_rejection',
      message: event.reason instanceof Error ? event.reason.message : 'Unhandled promise rejection',
      metadata: {
        route: window.location.pathname
      },
      error: event.reason
    })
  })
}
