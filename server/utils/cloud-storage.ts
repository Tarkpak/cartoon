import { TosClient } from '@volcengine/tos-sdk'
import { readFileSync } from 'node:fs'

type TosStorageConfig = {
  enabled: boolean
  accessKeyId: string
  accessKeySecret: string
  region: string
  endpoint: string
  endpointProtocol: 'http' | 'https'
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

let cachedConfig: TosStorageConfig | null = null
let cachedClient: TosClient | null = null
let hasWarnedMissingConfig = false

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
  const hasRequired = !!(accessKeyId && accessKeySecret && region && bucket && endpointConfig.endpoint)
  const enabledByEnv = parseBooleanEnv(process.env.TOS_ENABLED)
  const enabled = (enabledByEnv ?? true) && hasRequired

  if (!hasRequired && enabledByEnv && !hasWarnedMissingConfig) {
    hasWarnedMissingConfig = true
    console.warn('[CloudStorage] TOS_ENABLED=true 但缺少必填配置，已自动回退本地存储')
  }

  return {
    enabled,
    accessKeyId,
    accessKeySecret,
    region,
    endpoint: endpointConfig.endpoint,
    endpointProtocol: endpointConfig.protocol,
    bucket,
    keyPrefix: keyPrefix || undefined,
    publicBaseUrl,
    isCustomDomain
  }
}

function getConfig(): TosStorageConfig {
  if (!cachedConfig) {
    cachedConfig = createConfig()
  }
  return cachedConfig
}

function getClient(config: TosStorageConfig): TosClient | null {
  if (!config.enabled) return null
  if (cachedClient) return cachedClient

  try {
    cachedClient = new TosClient({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      region: config.region,
      endpoint: config.endpoint,
      secure: config.endpointProtocol === 'https',
      isCustomDomain: config.isCustomDomain
    })
  } catch (error) {
    console.error('[CloudStorage] 初始化 TOS 客户端失败:', error)
    cachedClient = null
  }

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
