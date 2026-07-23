import { createHash, createHmac } from 'node:crypto'
import { createError } from 'h3'
import { XMLParser } from 'fast-xml-parser'
import { tosStorageClientConfig } from './tos-storage'

interface TosListObject {
  ETag?: string
  Key?: string
  LastModified?: string | Date
  Size?: number | string
  StorageClass?: string
}

interface TosCommonPrefix {
  Prefix?: string
}

interface TosListOutput {
  Name?: string
  Prefix?: string
  KeyCount?: number | string
  MaxKeys?: number
  Delimiter?: string
  IsTruncated?: boolean
  NextContinuationToken?: string
  CommonPrefixes?: TosCommonPrefix[]
  Contents?: TosListObject[]
}

interface TosErrorOutput {
  Error?: {
    Code?: string
    Message?: string
    RequestId?: string
    HostId?: string
  }
}

type TosListResponse = TosListOutput | { ListBucketResult?: TosListOutput }

export interface TosFilesListOptions {
  prefix?: string
  prefixProvided?: boolean
  delimiter?: string
  maxKeys?: number
  continuationToken?: string
}

const TOS_ALGORITHM = 'TOS4-HMAC-SHA256'
const TOS_SERVICE = 'tos'
const TOS_REQUEST = 'request'
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false
})

function normalizeObjectPath(value: string) {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(segment => segment.trim())
    .join('/')
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value
  return value == null ? [] : [value]
}

function textValue(value: unknown) {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && '#text' in value) {
    return String((value as { '#text'?: unknown })['#text'] || '')
  }
  return String(value)
}

function numberValue(value: unknown) {
  const number = Number.parseInt(textValue(value), 10)
  return Number.isFinite(number) ? number : 0
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.replace(/\/+$/g, '')
}

function normalizeEndpoint(raw: string) {
  const trimmed = raw.trim().replace(/\/+$/g, '')
  if (trimmed.startsWith('http://')) {
    return { endpoint: trimmed.slice('http://'.length).replace(/^\/+|\/+$/g, ''), secure: false }
  }
  if (trimmed.startsWith('https://')) {
    return { endpoint: trimmed.slice('https://'.length).replace(/^\/+|\/+$/g, ''), secure: true }
  }
  return { endpoint: trimmed.replace(/^\/+|\/+$/g, ''), secure: true }
}

function encodeObjectKey(key: string) {
  return key
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encodeObjectPath(key: string) {
  return key
    .split('/')
    .map(segment => encodeRfc3986(segment))
    .join('/')
}

function canonicalQueryString(query: Record<string, string | undefined>) {
  return Object.entries(query)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([keyA, valueA], [keyB, valueB]) => {
      if (keyA !== keyB) return keyA < keyB ? -1 : 1
      if (valueA === valueB) return 0
      return valueA < valueB ? -1 : 1
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

function utcDateTime() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmacSha256(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

function hmacSha256Hex(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex')
}

function credentialScope(date: string, region: string) {
  return `${date}/${region}/${TOS_SERVICE}/${TOS_REQUEST}`
}

function signingKey(secretKey: string, date: string, region: string) {
  const dateKey = hmacSha256(secretKey, date)
  const regionKey = hmacSha256(dateKey, region)
  const serviceKey = hmacSha256(regionKey, TOS_SERVICE)
  return hmacSha256(serviceKey, TOS_REQUEST)
}

function buildCanonicalRequest(input: {
  method: string
  path: string
  query: string
  headers: Record<string, string>
  signedHeaders: string[]
}) {
  const canonicalHeaders = input.signedHeaders
    .map(key => `${key}:${input.headers[key].replace(/\s+/g, ' ').trim()}`)
    .join('\n')
  return [
    input.method,
    input.path,
    input.query,
    `${canonicalHeaders}\n`,
    input.signedHeaders.join(';'),
    UNSIGNED_PAYLOAD
  ].join('\n')
}

function signTosRequest(input: {
  method: string
  path: string
  query: string
  host: string
  accessKeyId: string
  secretKey: string
  securityToken: string
  region: string
  extraHeaders?: Record<string, string>
}) {
  const datetime = utcDateTime()
  const date = datetime.slice(0, 8)
  const headers: Record<string, string> = {
    host: input.host,
    'x-tos-content-sha256': UNSIGNED_PAYLOAD,
    'x-tos-date': datetime,
    ...Object.fromEntries(
      Object.entries(input.extraHeaders || {}).map(([key, value]) => [key.toLowerCase(), value])
    )
  }
  if (input.securityToken) {
    headers['x-tos-security-token'] = input.securityToken
  }
  const signedHeaders = Object.keys(headers).sort()
  const canonicalRequest = buildCanonicalRequest({
    method: input.method,
    path: input.path,
    query: input.query,
    headers,
    signedHeaders
  })
  const scope = credentialScope(date, input.region)
  const stringToSign = [
    TOS_ALGORITHM,
    datetime,
    scope,
    sha256Hex(canonicalRequest)
  ].join('\n')
  const signature = hmacSha256Hex(signingKey(input.secretKey, date, input.region), stringToSign)
  return {
    headers: {
      'x-tos-content-sha256': UNSIGNED_PAYLOAD,
      'x-tos-date': datetime,
      ...(input.securityToken ? { 'x-tos-security-token': input.securityToken } : {}),
      ...input.extraHeaders,
      authorization: `${TOS_ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`
    }
  }
}

function objectRequestTarget(
  config: ReturnType<typeof tosStorageClientConfig>,
  endpoint: string,
  key: string
) {
  const encodedKey = encodeObjectPath(key)
  if (config.isCustomDomain) {
    return { host: endpoint, path: `/${encodedKey}` }
  }
  if (/^(\d|:)/.test(endpoint)) {
    return { host: endpoint, path: `/${config.bucket}/${encodedKey}` }
  }
  return { host: `${config.bucket}.${endpoint}`, path: `/${encodedKey}` }
}

function buildPresignedUrl(input: {
  endpoint: string
  secure: boolean
  bucket: string
  key: string
  accessKeyId: string
  secretKey: string
  securityToken: string
  region: string
  isCustomDomain: boolean
  expires: number
  downloadName?: string
}) {
  const protocol = input.secure ? 'https' : 'http'
  const path = `/${encodeObjectPath(input.key)}`
  const host = input.isCustomDomain
    ? input.endpoint
    : `${input.bucket}.${input.endpoint}`
  const datetime = utcDateTime()
  const date = datetime.slice(0, 8)
  const scope = credentialScope(date, input.region)
  const signedHeaders = 'host'
  const queryWithoutSignature: Record<string, string> = {
    'X-Tos-Algorithm': TOS_ALGORITHM,
    'X-Tos-Content-Sha256': UNSIGNED_PAYLOAD,
    'X-Tos-Credential': `${input.accessKeyId}/${scope}`,
    'X-Tos-Date': datetime,
    'X-Tos-Expires': String(input.expires),
    'X-Tos-SignedHeaders': signedHeaders
  }
  if (input.securityToken) {
    queryWithoutSignature['X-Tos-Security-Token'] = input.securityToken
  }
  if (input.downloadName) {
    queryWithoutSignature['response-content-disposition'] = downloadContentDisposition(input.downloadName)
  }
  const query = canonicalQueryString(queryWithoutSignature)
  const canonicalRequest = buildCanonicalRequest({
    method: 'GET',
    path,
    query,
    headers: { host },
    signedHeaders: [signedHeaders]
  })
  const stringToSign = [
    TOS_ALGORITHM,
    datetime,
    scope,
    sha256Hex(canonicalRequest)
  ].join('\n')
  const signature = hmacSha256Hex(signingKey(input.secretKey, date, input.region), stringToSign)
  return `${protocol}://${host}${path}?${query}&X-Tos-Signature=${signature}`
}

export function downloadContentDisposition(filename: string) {
  const normalized = filename.replace(/[\r\n]/g, '').trim() || 'download'
  const fallbackName = normalized.replace(/[^A-Za-z0-9._-]/g, '_')
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(normalized)}`
}

export function tosFileDownloadUrl(key: string, downloadName?: string) {
  const config = tosStorageClientConfig()
  assertConfigured(config)
  const normalizedKey = normalizeObjectPath(key)
  if (!normalizedKey) {
    throw createError({ statusCode: 400, statusMessage: '文件 Key 不能为空' })
  }
  const { endpoint, secure } = normalizeEndpoint(config.endpoint)
  return buildPresignedUrl({
    endpoint,
    secure,
    bucket: config.bucket,
    key: normalizedKey,
    accessKeyId: config.accessKeyId,
    secretKey: config.secretKey,
    securityToken: config.securityToken,
    region: config.region,
    isCustomDomain: config.isCustomDomain,
    expires: 300,
    downloadName: downloadName || normalizedKey.split('/').pop() || 'download'
  })
}

function buildPublicUrl(input: {
  endpoint: string
  secure: boolean
  bucket: string
  key: string
  publicBaseUrl: string
  isCustomDomain: boolean
}) {
  const encodedKey = encodeObjectKey(input.key)
  const publicBaseUrl = normalizeBaseUrl(input.publicBaseUrl)
  if (publicBaseUrl) return `${publicBaseUrl}/${encodedKey}`

  const protocol = input.secure ? 'https' : 'http'
  if (input.isCustomDomain) return `${protocol}://${input.endpoint}/${encodedKey}`
  return `${protocol}://${input.bucket}.${input.endpoint}/${encodedKey}`
}

function assertConfigured(config: ReturnType<typeof tosStorageClientConfig>) {
  if (!config.enabled) {
    throw createError({ statusCode: 400, statusMessage: '云存储未启用' })
  }
  const missing: string[] = []
  if (!config.accessKeyId) missing.push('Access Key ID')
  if (!config.secretKey) missing.push('Secret Key')
  if (!config.region) missing.push('Region')
  if (!config.endpoint) missing.push('Endpoint')
  if (!config.bucket) missing.push('Bucket')
  if (missing.length > 0) {
    throw createError({ statusCode: 400, statusMessage: `云存储配置不完整：${missing.join('、')}` })
  }
}

function bucketListTarget(config: ReturnType<typeof tosStorageClientConfig>, endpoint: string) {
  if (config.isCustomDomain) {
    return { host: endpoint, path: '/' }
  }
  if (/^(\d|:)/.test(endpoint)) {
    return { host: endpoint, path: `/${config.bucket}/` }
  }
  return { host: `${config.bucket}.${endpoint}`, path: '/' }
}

function parseTosError(xml: string) {
  try {
    const parsed = JSON.parse(xml) as Record<string, unknown> | null
    const source = parsed && typeof parsed === 'object' && 'Error' in parsed
      ? parsed.Error
      : parsed
    const error = source && typeof source === 'object'
      ? source as Record<string, unknown>
      : {}
    return {
      code: textValue(error.Code),
      message: textValue(error.Message),
      requestId: textValue(error.RequestId),
      hostId: textValue(error.HostId)
    }
  } catch {
    // Fall through to XML parsing.
  }

  try {
    const parsed = xmlParser.parse(xml) as TosErrorOutput
    const error = parsed.Error || {}
    return {
      code: textValue(error.Code),
      message: textValue(error.Message),
      requestId: textValue(error.RequestId),
      hostId: textValue(error.HostId)
    }
  } catch {
    return {
      code: '',
      message: xml.trim(),
      requestId: '',
      hostId: ''
    }
  }
}

function parseTosList(text: string): TosListOutput {
  const trimmed = text.trim()
  if (!trimmed) return {}

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as TosListOutput
    return parsed || {}
  }

  const parsed = xmlParser.parse(text) as TosListResponse
  return 'ListBucketResult' in parsed
    ? parsed.ListBucketResult || {}
    : parsed as TosListOutput || {}
}

function tosErrorMessage(status: number, code: string, message: string) {
  if (code === 'SignatureDoesNotMatch') {
    return 'TOS 请求签名失败，请检查 Secret Key、Region、Endpoint、Bucket 和自定义域名配置'
  }
  if (code === 'InvalidAccessKeyId') {
    return 'TOS Access Key ID 无效，请检查云存储配置'
  }
  if (code === 'AccessDenied') {
    return 'TOS 访问被拒绝，请检查 AK/SK 权限是否允许 ListBucket 和 GetObject'
  }
  return message || `TOS 请求失败（HTTP ${status}）`
}

async function fetchTosList(input: {
  config: ReturnType<typeof tosStorageClientConfig>
  endpoint: string
  secure: boolean
  query: Record<string, string | undefined>
}) {
  const target = bucketListTarget(input.config, input.endpoint)
  const query = canonicalQueryString(input.query)
  const protocol = input.secure ? 'https' : 'http'
  const signed = signTosRequest({
    method: 'GET',
    path: target.path,
    query,
    host: target.host,
    accessKeyId: input.config.accessKeyId,
    secretKey: input.config.secretKey,
    securityToken: input.config.securityToken,
    region: input.config.region
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(`${protocol}://${target.host}${target.path}?${query}`, {
      method: 'GET',
      headers: signed.headers,
      signal: controller.signal
    })
    const text = await response.text()
    if (!response.ok) {
      const error = parseTosError(text)
      throw createError({
        statusCode: response.status,
        statusMessage: tosErrorMessage(response.status, error.code, error.message),
        data: {
          code: error.code,
          requestId: error.requestId,
          hostId: error.hostId
        }
      })
    }
    return parseTosList(text)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw createError({ statusCode: 504, statusMessage: 'TOS 请求超时' })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function listTosFiles(options: TosFilesListOptions = {}) {
  const config = tosStorageClientConfig()
  assertConfigured(config)

  const { endpoint, secure } = normalizeEndpoint(config.endpoint)
  const configuredPrefix = normalizeObjectPath(config.keyPrefix)
  const prefix = options.prefixProvided
    ? normalizeObjectPath(options.prefix || '')
    : configuredPrefix
  const delimiter = typeof options.delimiter === 'string'
    ? options.delimiter.trim()
    : '/'
  const maxKeys = Math.min(1000, Math.max(1, Math.floor(options.maxKeys || 100)))
  const listPrefix = delimiter && prefix ? `${prefix.replace(/\/+$/g, '')}/` : prefix

  const response = await fetchTosList({
    config,
    endpoint,
    secure,
    query: {
      'list-type': '2',
      'list-only-once': 'true',
      prefix: listPrefix || undefined,
      delimiter: delimiter || undefined,
      'max-keys': String(maxKeys),
      'continuation-token': options.continuationToken || undefined
    }
  })
  const data = response || {}

  return {
    bucket: textValue(data.Name) || config.bucket,
    configuredPrefix,
    prefix: textValue(data.Prefix) || listPrefix || '',
    delimiter: textValue(data.Delimiter) || delimiter || undefined,
    maxKeys: numberValue(data.MaxKeys) || maxKeys,
    isTruncated: textValue(data.IsTruncated).toLowerCase() === 'true',
    nextContinuationToken: textValue(data.NextContinuationToken) || undefined,
    commonPrefixes: toArray(data.CommonPrefixes)
      .map(item => textValue(item.Prefix))
      .filter(Boolean),
    files: toArray(data.Contents).map((item) => {
      const key = textValue(item.Key)
      let signedUrl = ''
      try {
        signedUrl = key
          ? buildPresignedUrl({
              endpoint,
              secure,
              bucket: config.bucket,
              key,
              accessKeyId: config.accessKeyId,
              secretKey: config.secretKey,
              securityToken: config.securityToken,
              region: config.region,
              isCustomDomain: config.isCustomDomain,
              expires: 1800
            })
          : ''
      } catch {
        signedUrl = ''
      }
      return {
        key,
        size: numberValue(item.Size),
        lastModified: textValue(item.LastModified),
        storageClass: textValue(item.StorageClass),
        etag: textValue(item.ETag).replace(/^"|"$/g, ''),
        url: signedUrl || buildPublicUrl({
          endpoint,
          secure,
          bucket: config.bucket,
          key,
          publicBaseUrl: config.publicBaseUrl,
          isCustomDomain: config.isCustomDomain
        })
      }
    })
  }
}

export async function copyTosObject(sourceKey: string, targetKey: string) {
  const config = tosStorageClientConfig()
  assertConfigured(config)
  const source = normalizeObjectPath(sourceKey)
  const target = normalizeObjectPath(targetKey)
  if (!source || !target) {
    throw createError({ statusCode: 400, statusMessage: '复制源 Key 和目标 Key 不能为空' })
  }

  const { endpoint, secure } = normalizeEndpoint(config.endpoint)
  const requestTarget = objectRequestTarget(config, endpoint, target)
  const copySource = `${config.bucket}/${encodeObjectPath(source)}`
  const signed = signTosRequest({
    method: 'PUT',
    path: requestTarget.path,
    query: '',
    host: requestTarget.host,
    accessKeyId: config.accessKeyId,
    secretKey: config.secretKey,
    securityToken: config.securityToken,
    region: config.region,
    extraHeaders: {
      'x-tos-copy-source': copySource,
      'x-tos-forbid-overwrite': 'true'
    }
  })
  const protocol = secure ? 'https' : 'http'
  const response = await fetch(`${protocol}://${requestTarget.host}${requestTarget.path}`, {
    method: 'PUT',
    headers: signed.headers
  })
  const text = await response.text()
  if (response.ok) return { copied: true as const }
  if (response.status === 409 || response.status === 412) {
    return { copied: false as const, reason: 'target-exists' as const }
  }
  const error = parseTosError(text)
  throw createError({
    statusCode: response.status,
    statusMessage: tosErrorMessage(response.status, error.code, error.message),
    data: { code: error.code, requestId: error.requestId }
  })
}
