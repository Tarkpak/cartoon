import { createError } from 'h3'
import { decryptText, encryptText } from './crypto'
import { getDb, nowIso } from './db'

const TOS_STORAGE_CONFIG_ID = 'default'

export interface TosStorageConfigRow {
  id: string
  enabled: number
  access_key_id: string
  encrypted_secret_key: string
  encrypted_security_token: string
  region: string
  endpoint: string
  bucket: string
  key_prefix: string
  public_base_url: string
  is_custom_domain: number
  created_at: string
  updated_at: string
}

export interface TosStorageConfigInput extends Record<string, unknown> {
  enabled?: unknown
  accessKeyId?: unknown
  secretKey?: unknown
  securityToken?: unknown
  region?: unknown
  endpoint?: unknown
  bucket?: unknown
  keyPrefix?: unknown
  publicBaseUrl?: unknown
  isCustomDomain?: unknown
}

function getString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function getBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key)
}

export function getTosStorageConfigRow() {
  return getDb()
    .prepare('SELECT * FROM tos_storage_config WHERE id = ? LIMIT 1')
    .get(TOS_STORAGE_CONFIG_ID) as TosStorageConfigRow | undefined
}

export function tosStoragePublicConfig(row = getTosStorageConfigRow()) {
  return {
    enabled: Boolean(row?.enabled),
    accessKeyId: row?.access_key_id || '',
    hasSecretKey: Boolean(row?.encrypted_secret_key),
    hasSecurityToken: Boolean(row?.encrypted_security_token),
    region: row?.region || '',
    endpoint: row?.endpoint || '',
    bucket: row?.bucket || '',
    keyPrefix: row?.key_prefix || '',
    publicBaseUrl: row?.public_base_url || '',
    isCustomDomain: Boolean(row?.is_custom_domain),
    updatedAt: row?.updated_at || null
  }
}

export function tosStorageClientConfig(row = getTosStorageConfigRow()) {
  return {
    enabled: Boolean(row?.enabled),
    accessKeyId: row?.access_key_id || '',
    secretKey: decryptText(row?.encrypted_secret_key),
    securityToken: decryptText(row?.encrypted_security_token),
    region: row?.region || '',
    endpoint: row?.endpoint || '',
    bucket: row?.bucket || '',
    keyPrefix: row?.key_prefix || '',
    publicBaseUrl: row?.public_base_url || '',
    isCustomDomain: Boolean(row?.is_custom_domain)
  }
}

export function isTosStorageConfigured(row = getTosStorageConfigRow()) {
  if (!row?.enabled) return false
  return Boolean(
    row.access_key_id
    && row.encrypted_secret_key
    && row.region
    && row.endpoint
    && row.bucket
  )
}

export function saveTosStorageConfig(input: TosStorageConfigInput) {
  const db = getDb()
  const existing = getTosStorageConfigRow()
  const body = input as Record<string, unknown>
  const enabled = hasOwn(body, 'enabled')
    ? getBoolean(body.enabled)
    : Boolean(existing?.enabled)
  const accessKeyId = hasOwn(body, 'accessKeyId')
    ? getString(body.accessKeyId, 512)
    : existing?.access_key_id || ''
  const encryptedSecretKey = hasOwn(body, 'secretKey')
    ? encryptText(getString(body.secretKey, 4096))
    : existing?.encrypted_secret_key || ''
  const encryptedSecurityToken = hasOwn(body, 'securityToken')
    ? encryptText(getString(body.securityToken, 4096))
    : existing?.encrypted_security_token || ''
  const region = hasOwn(body, 'region')
    ? getString(body.region, 256)
    : existing?.region || ''
  const endpoint = hasOwn(body, 'endpoint')
    ? getString(body.endpoint, 2048)
    : existing?.endpoint || ''
  const bucket = hasOwn(body, 'bucket')
    ? getString(body.bucket, 512)
    : existing?.bucket || ''
  const keyPrefix = hasOwn(body, 'keyPrefix')
    ? getString(body.keyPrefix, 2048)
    : existing?.key_prefix || ''
  const publicBaseUrl = hasOwn(body, 'publicBaseUrl')
    ? getString(body.publicBaseUrl, 2048)
    : existing?.public_base_url || ''
  const isCustomDomain = hasOwn(body, 'isCustomDomain')
    ? getBoolean(body.isCustomDomain)
    : Boolean(existing?.is_custom_domain)

  if (enabled) {
    const missing: string[] = []
    if (!accessKeyId) missing.push('Access Key ID')
    if (!encryptedSecretKey) missing.push('Secret Key')
    if (!region) missing.push('Region')
    if (!endpoint) missing.push('Endpoint')
    if (!bucket) missing.push('Bucket')
    if (missing.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `启用云存储前请补齐：${missing.join('、')}`
      })
    }
  }

  const timestamp = nowIso()
  db.prepare(`
    INSERT INTO tos_storage_config
      (id, enabled, access_key_id, encrypted_secret_key, encrypted_security_token, region, endpoint, bucket, key_prefix, public_base_url, is_custom_domain, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      access_key_id = excluded.access_key_id,
      encrypted_secret_key = excluded.encrypted_secret_key,
      encrypted_security_token = excluded.encrypted_security_token,
      region = excluded.region,
      endpoint = excluded.endpoint,
      bucket = excluded.bucket,
      key_prefix = excluded.key_prefix,
      public_base_url = excluded.public_base_url,
      is_custom_domain = excluded.is_custom_domain,
      updated_at = excluded.updated_at
  `).run(
    TOS_STORAGE_CONFIG_ID,
    enabled ? 1 : 0,
    accessKeyId,
    encryptedSecretKey,
    encryptedSecurityToken,
    region,
    endpoint,
    bucket,
    keyPrefix,
    publicBaseUrl,
    isCustomDomain ? 1 : 0,
    existing?.created_at || timestamp,
    timestamp
  )

  return getTosStorageConfigRow()
}
