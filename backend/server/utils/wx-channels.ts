import { decryptText, encryptText } from './crypto'
import { getDb, nowIso } from './db'

const WX_CHANNELS_CONFIG_ID = 'default'

export interface WxChannelsConfigRow {
  id: string
  encrypted_yuanbao_cookie: string
  created_at: string
  updated_at: string
}

export interface WxChannelsConfigInput extends Record<string, unknown> {
  yuanbaoCookie?: unknown
  clear?: unknown
}

function getString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key)
}

export function getWxChannelsConfigRow() {
  return getDb()
    .prepare('SELECT * FROM wx_channels_config WHERE id = ? LIMIT 1')
    .get(WX_CHANNELS_CONFIG_ID) as WxChannelsConfigRow | undefined
}

export function wxChannelsPublicConfig(row = getWxChannelsConfigRow()) {
  return {
    hasYuanbaoCookie: Boolean(row?.encrypted_yuanbao_cookie),
    updatedAt: row?.updated_at || null
  }
}

export function wxChannelsClientConfig(row = getWxChannelsConfigRow()) {
  return {
    yuanbaoCookie: decryptText(row?.encrypted_yuanbao_cookie)
  }
}

export function isWxChannelsConfigured(row = getWxChannelsConfigRow()) {
  return Boolean(row?.encrypted_yuanbao_cookie)
}

export function saveWxChannelsConfig(input: WxChannelsConfigInput) {
  const db = getDb()
  const existing = getWxChannelsConfigRow()
  const body = input as Record<string, unknown>
  const timestamp = nowIso()
  const shouldClear = body.clear === true
  const encryptedYuanbaoCookie = shouldClear
    ? ''
    : hasOwn(body, 'yuanbaoCookie')
      ? encryptText(getString(body.yuanbaoCookie, 32768))
      : existing?.encrypted_yuanbao_cookie || ''

  db.prepare(`
    INSERT INTO wx_channels_config
      (id, encrypted_yuanbao_cookie, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      encrypted_yuanbao_cookie = excluded.encrypted_yuanbao_cookie,
      updated_at = excluded.updated_at
  `).run(
    WX_CHANNELS_CONFIG_ID,
    encryptedYuanbaoCookie,
    existing?.created_at || timestamp,
    timestamp
  )

  return getWxChannelsConfigRow()
}
