import { TosClient } from '@volcengine/tos-sdk'
import { readFileSync } from 'node:fs'

type TosStorageConfig = {
  enabled: boolean
  accessKeyId: string
  accessKeySecret: string
  region: string
  endpoint: string
  endpointProtocol: 'http' | 'https'
  requestSecure: boolean
  proxyHost?: string
  proxyPort?: number
  proxySource: 'none' | 'tos' | 'system'
  bucket: string
  keyPrefix?: string
  publicBaseUrl?: string
  isCustomDomain: boolean
}

type UploadBufferOptions = {
  key: string
  buffer: Buffer
}

type UploadFileOptions = {
  key: string
  filePath: string
}

export type CloudStorageFileEntry = {
  key: string
  size: number
  lastModified: string
  storageClass: string
  etag: string
  url: string
}

export type CloudStorageListResult = {
  bucket: string
  prefix: string
  delimiter?: string
  maxKeys: number
  isTruncated: boolean
  nextContinuationToken?: string
  commonPrefixes: string[]
  files: CloudStorageFileEntry[]
}

const MAX_SORTABLE_TIMESTAMP = 9_999_999_999_999

export function buildCloudNewestFirstNamePrefix(timestampMs = Date.now()): string {
  const normalizedTimestamp = Number.isFinite(timestampMs)
    ? Math.max(0, Math.min(MAX_SORTABLE_TIMESTAMP, Math.floor(timestampMs)))
    : Date.now()
  const reversedTimestamp = MAX_SORTABLE_TIMESTAMP - normalizedTimestamp
  return String(reversedTimestamp).padStart(String(MAX_SORTABLE_TIMESTAMP).length, '0')
}

let cachedConfig: TosStorageConfig | null = null
let cachedClient: TosClient | null = null
let hasWarnedMissingConfig = false
let hasWarnedInvalidProxy = false

function parseBooleanEnv(value?: string): boolean | undefined {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized) return undefined
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

function normalizeBaseUrl(value?: string): string | undefined {
  const trimmed = (value || '').trim()
  if (!trimmed) return undefined
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.replace(/\/+$/, '')
}

function normalizeEndpoint(endpointRaw: string): {
  endpoint: string
  protocol: 'http' | 'https'
} {
  const trimmed = endpointRaw.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return {
      endpoint: '',
      protocol: 'https'
    }
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed)
    const protocol = parsed.protocol === 'http:' ? 'http' : 'https'
    const normalizedPath = trimSlashes(parsed.pathname || '')
    const endpoint = normalizedPath
      ? `${parsed.host}/${normalizedPath}`
      : parsed.host
    return {
      endpoint,
      protocol
    }
  }

  return {
    endpoint: trimSlashes(trimmed),
    protocol: 'https'
  }
}

function normalizeObjectPath(value: string): string {
  return trimSlashes(value).replace(/\/{2,}/g, '/')
}

function getFirstEnvValue(keys: string[]): string {
  for (const key of keys) {
    const value = (process.env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function addNoProxyEntries(entries: string[]) {
  const normalizedEntries = entries
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
  if (normalizedEntries.length === 0) return

  const existing = [
    ...(process.env.NO_PROXY || '').split(','),
    ...(process.env.no_proxy || '').split(',')
  ]
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
  const merged = Array.from(new Set([...existing, ...normalizedEntries]))
  const next = merged.join(',')

  process.env.NO_PROXY = next
  process.env.no_proxy = next
}

function extractEndpointHost(endpoint: string): string {
  const normalized = endpoint.trim().replace(/^https?:\/\//i, '')
  return (normalized.split('/')[0] || '').trim().toLowerCase()
}

function applyNoProxyForTosEndpoint(config: {
  endpoint: string
  bucket: string
  isCustomDomain: boolean
}) {
  const endpointHost = extractEndpointHost(config.endpoint)
  if (!endpointHost) return

  const entries: string[] = [endpointHost]
  if (!config.isCustomDomain) {
    const bucket = config.bucket.trim().toLowerCase()
    if (bucket) {
      entries.push(`${bucket}.${endpointHost}`)
    }
    entries.push(`.${endpointHost}`)
  }

  addNoProxyEntries(entries)
}

function resolveProxyHostPort(): {
  host: string
  port: number
  source: 'tos' | 'system'
} | null {
  const rawTosProxy = getFirstEnvValue([
    'TOS_PROXY',
    'tos_proxy'
  ])
  const rawProxy = rawTosProxy

  if (!rawProxy) return null

  const normalizedProxy = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawProxy)
    ? rawProxy
    : `http://${rawProxy}`

  let parsed: URL
  try {
    parsed = new URL(normalizedProxy)
  } catch {
    if (!hasWarnedInvalidProxy) {
      hasWarnedInvalidProxy = true
      console.warn('[CloudStorage] 代理地址格式无效，已忽略代理配置')
    }
    return null
  }

  if (parsed.protocol !== 'http:') {
    if (!hasWarnedInvalidProxy) {
      hasWarnedInvalidProxy = true
      console.warn('[CloudStorage] TOS 仅支持 HTTP 代理（http://host:port），已忽略当前代理配置')
    }
    return null
  }

  const host = parsed.hostname.trim()
  const portRaw = parsed.port || '80'
  const port = Number(portRaw)
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    if (!hasWarnedInvalidProxy) {
      hasWarnedInvalidProxy = true
      console.warn('[CloudStorage] 代理 host/port 无效，已忽略代理配置')
    }
    return null
  }

  if ((parsed.username || parsed.password) && !hasWarnedInvalidProxy) {
    hasWarnedInvalidProxy = true
    console.warn('[CloudStorage] TOS 代理暂不支持账号密码，已忽略代理认证信息')
  }

  return {
    host,
    port,
    source: rawTosProxy ? 'tos' : 'system'
  }
}

function shouldRetryWithoutSystemProxy(config: TosStorageConfig, error: unknown): boolean {
  if (config.proxySource !== 'system' || !config.proxyHost || !config.proxyPort) {
    return false
  }

  const message = (
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error)
  ).toLowerCase()

  return message.includes('socket hang up')
    || message.includes('econnreset')
    || message.includes('etimedout')
    || message.includes('eof')
}

function stripProxyFromConfig(config: TosStorageConfig): TosStorageConfig {
  return {
    ...config,
    requestSecure: config.endpointProtocol === 'https',
    proxyHost: undefined,
    proxyPort: undefined,
    proxySource: 'none'
  }
}

function joinObjectPath(...parts: Array<string | undefined>): string {
  const normalized = parts
    .map(part => normalizeObjectPath(part || ''))
    .filter(Boolean)
  return normalized.join('/')
}

function encodeObjectKey(key: string): string {
  return key
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

function createConfig(): TosStorageConfig {
  const accessKeyId = (process.env.TOS_ACCESS_KEY || '').trim()
  const accessKeySecret = (process.env.TOS_SECRET_KEY || '').trim()
  const region = (process.env.TOS_REGION || '').trim()
  const bucket = (process.env.TOS_BUCKET || '').trim()
  const keyPrefix = normalizeObjectPath(process.env.TOS_KEY_PREFIX || '')
  const publicBaseUrl = normalizeBaseUrl(process.env.TOS_PUBLIC_BASE_URL)
  const isCustomDomain = parseBooleanEnv(process.env.TOS_IS_CUSTOM_DOMAIN) ?? false
  const endpointConfig = normalizeEndpoint(process.env.TOS_ENDPOINT || '')
  const proxyConfig = resolveProxyHostPort()
  const hasRequired = !!(accessKeyId && accessKeySecret && region && bucket && endpointConfig.endpoint)
  const enabledByEnv = parseBooleanEnv(process.env.TOS_ENABLED)
  const enabled = (enabledByEnv ?? true) && hasRequired

  if (!hasRequired && enabledByEnv && !hasWarnedMissingConfig) {
    hasWarnedMissingConfig = true
    console.warn('[CloudStorage] TOS_ENABLED=true 但缺少必填配置，已自动回退本地存储')
  }

  const config: TosStorageConfig = {
    enabled,
    accessKeyId,
    accessKeySecret,
    region,
    endpoint: endpointConfig.endpoint,
    endpointProtocol: endpointConfig.protocol,
    requestSecure: proxyConfig ? false : endpointConfig.protocol === 'https',
    proxyHost: proxyConfig?.host,
    proxyPort: proxyConfig?.port,
    proxySource: proxyConfig?.source || 'none',
    bucket,
    keyPrefix: keyPrefix || undefined,
    publicBaseUrl,
    isCustomDomain
  }

  if (config.enabled && !proxyConfig) {
    applyNoProxyForTosEndpoint({
      endpoint: config.endpoint,
      bucket: config.bucket,
      isCustomDomain: config.isCustomDomain
    })
  }

  return config
}

function getConfig(): TosStorageConfig {
  if (!cachedConfig) {
    cachedConfig = createConfig()
  }
  return cachedConfig
}

function createTosClient(config: TosStorageConfig): TosClient | null {
  try {
    const clientOptions: ConstructorParameters<typeof TosClient>[0] = {
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      region: config.region,
      endpoint: config.endpoint,
      secure: config.requestSecure,
      isCustomDomain: config.isCustomDomain
    }

    if (config.proxyHost && config.proxyPort) {
      clientOptions.proxyHost = config.proxyHost
      clientOptions.proxyPort = config.proxyPort
    }

    return new TosClient(clientOptions)
  } catch (error) {
    console.error('[CloudStorage] 初始化 TOS 客户端失败:', error)
    return null
  }
}

function getClient(config: TosStorageConfig): TosClient | null {
  if (!config.enabled) return null
  if (cachedClient) return cachedClient

  cachedClient = createTosClient(config)

  return cachedClient
}

function buildPublicObjectUrl(config: TosStorageConfig, objectKey: string): string {
  const encodedKey = encodeObjectKey(objectKey)
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl}/${encodedKey}`
  }

  if (config.isCustomDomain) {
    return `${config.endpointProtocol}://${config.endpoint}/${encodedKey}`
  }

  return `${config.endpointProtocol}://${config.bucket}.${config.endpoint}/${encodedKey}`
}

function getDisabledReason(config: TosStorageConfig): string {
  if (config.enabled) return ''
  return 'TOS 未启用或配置不完整（请检查 TOS_ENABLED / TOS_ACCESS_KEY / TOS_SECRET_KEY / TOS_REGION / TOS_ENDPOINT / TOS_BUCKET）'
}

export function isCloudStorageEnabled(): boolean {
  return getConfig().enabled
}

export function buildCloudObjectKey(options: {
  category: string
  filename: string
}): string {
  return joinObjectPath(
    getConfig().keyPrefix,
    options.category,
    options.filename
  )
}

export function buildCloudPublicUrlByObjectKey(objectKey: string): string | null {
  const config = getConfig()
  if (!config.enabled) return null
  const normalizedKey = normalizeObjectPath(objectKey)
  if (!normalizedKey) return null
  return buildPublicObjectUrl(config, normalizedKey)
}

export async function listCloudStorageFiles(options: {
  prefix?: string
  delimiter?: string
  maxKeys?: number
  continuationToken?: string
} = {}): Promise<CloudStorageListResult> {
  const config = getConfig()
  if (!config.enabled) {
    throw new Error(getDisabledReason(config))
  }

  const client = getClient(config)
  if (!client) {
    throw new Error('TOS 客户端初始化失败')
  }

  const maxKeys = Math.max(1, Math.min(1000, Math.floor(options.maxKeys || 100)))
  const normalizedPrefix = normalizeObjectPath(options.prefix ?? config.keyPrefix ?? '')
  const request: Parameters<TosClient['listObjectsType2']>[0] = {
    bucket: config.bucket,
    maxKeys,
    listOnlyOnce: true
  }

  // Do not pass undefined query fields to SDK.
  // The signer may include them in canonical query while HTTP layer drops them, causing SignatureDoesNotMatch.
  const delimiter = options.delimiter?.trim()
  if (delimiter) request.delimiter = delimiter
  const listPrefix = delimiter && normalizedPrefix
    ? `${normalizedPrefix}/`
    : normalizedPrefix
  request.prefix = listPrefix
  const continuationToken = options.continuationToken?.trim()
  if (continuationToken) request.continuationToken = continuationToken

  const response = await client.listObjectsType2(request)

  const data = response.data

  return {
    bucket: data.Name || config.bucket,
    prefix: data.Prefix || listPrefix,
    delimiter: data.Delimiter,
    maxKeys: data.MaxKeys || maxKeys,
    isTruncated: !!data.IsTruncated,
    nextContinuationToken: data.NextContinuationToken,
    commonPrefixes: (data.CommonPrefixes || []).map(item => item.Prefix).filter(Boolean),
    files: (data.Contents || [])
      .map(item => ({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified,
        storageClass: item.StorageClass,
        etag: item.ETag,
        url: buildPublicObjectUrl(config, item.Key)
      }))
  }
}

export async function uploadBufferToCloudStorage(options: UploadBufferOptions): Promise<string | null> {
  const config = getConfig()
  if (!config.enabled) return null

  const client = getClient(config)
  if (!client) return null

  const objectKey = normalizeObjectPath(options.key)
  if (!objectKey) return null

  try {
    await client.putObject({
      bucket: config.bucket,
      key: objectKey,
      body: options.buffer
    })
    return buildPublicObjectUrl(config, objectKey)
  } catch (error) {
    if (shouldRetryWithoutSystemProxy(config, error)) {
      console.warn('[CloudStorage] 系统代理上传失败，尝试直连重试一次:', error instanceof Error ? error.message : String(error))
      const directConfig = stripProxyFromConfig(config)
      const directClient = createTosClient(directConfig)

      if (directClient) {
        try {
          await directClient.putObject({
            bucket: directConfig.bucket,
            key: objectKey,
            body: options.buffer
          })
          return buildPublicObjectUrl(directConfig, objectKey)
        } catch (directError) {
          console.error('[CloudStorage] 直连重试失败:', directError)
        }
      }
    }

    console.error('[CloudStorage] 上传失败:', error)
    return null
  }
}

export async function uploadBufferToCloudStorageOrThrow(options: UploadBufferOptions): Promise<string> {
  const config = getConfig()
  if (!config.enabled) {
    throw new Error(getDisabledReason(config))
  }

  const url = await uploadBufferToCloudStorage(options)
  if (!url) {
    throw new Error('上传到 TOS 失败')
  }
  return url
}

export async function uploadFileToCloudStorage(options: UploadFileOptions): Promise<string | null> {
  const buffer = readFileSync(options.filePath)
  return uploadBufferToCloudStorage({
    key: options.key,
    buffer
  })
}

export async function uploadFileToCloudStorageOrThrow(options: UploadFileOptions): Promise<string> {
  const buffer = readFileSync(options.filePath)
  return uploadBufferToCloudStorageOrThrow({
    key: options.key,
    buffer
  })
}
