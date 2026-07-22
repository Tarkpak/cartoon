import {
  createError,
  deleteCookie,
  getCookie,
  getRequestHeader,
  readBody,
  setCookie,
  type H3Event
} from 'h3'
import { randomUUID } from 'node:crypto'
import { getAppSettings, getDb, nowIso } from './db'
import { hashToken, randomToken } from './crypto'

export const SESSION_COOKIE = 'playlet_admin_session'

export interface AuthUser {
  id: string
  account: string
  display_name: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
}

export interface AuthContext {
  user: AuthUser
  sessionId: string
  deviceId: string | null
}

interface UserRow {
  id: string
  account: string
  display_name: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  updated_at?: string
}

interface SessionRow {
  id: string
  user_id: string
  device_id: string | null
  revoked_at: string | null
}

const NON_EXPIRING_SESSION_EXPIRES_AT = '9999-12-31T23:59:59.999Z'

function isDisabledExpired(disabledAt: string | null | undefined) {
  const graceSeconds = getAppSettings().disabledGraceSeconds
  if (graceSeconds <= 0) return true

  const disabledTime = disabledAt ? Date.parse(disabledAt) : Number.NaN
  if (!Number.isFinite(disabledTime)) return true

  return Date.now() >= disabledTime + graceSeconds * 1000
}

function assertActiveOrWithinGrace(input: {
  status: string
  updatedAt?: string | null
  message: string
}) {
  if (input.status !== 'disabled') return
  if (isDisabledExpired(input.updatedAt)) {
    throw createError({ statusCode: 403, statusMessage: input.message })
  }
}

export async function readJsonBody<T extends Record<string, unknown>>(event: H3Event) {
  const body = await readBody<T>(event)
  return body || ({} as T)
}

export function publicUser(row: UserRow) {
  return {
    id: row.id,
    account: row.account,
    displayName: row.display_name,
    role: row.role,
    status: row.status
  }
}

export function getSessionToken(event: H3Event) {
  const auth = getRequestHeader(event, 'authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return getCookie(event, SESSION_COOKIE) || ''
}

export function setSessionCookie(event: H3Event, token: string) {
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  })
}

export function clearSessionCookie(event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

export function requireAuth(event: H3Event): AuthContext {
  const token = getSessionToken(event)
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  const db = getDb()
  const session = db
    .prepare('SELECT id, user_id, device_id, revoked_at FROM sessions WHERE token_hash = ? LIMIT 1')
    .get(hashToken(token)) as SessionRow | undefined

  if (!session || session.revoked_at) {
    throw createError({ statusCode: 401, statusMessage: 'Session invalid or revoked' })
  }

  const user = db
    .prepare('SELECT id, account, display_name, role, status, updated_at FROM users WHERE id = ? LIMIT 1')
    .get(session.user_id) as UserRow | undefined

  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'User not found' })
  }
  assertActiveOrWithinGrace({
    status: user.status,
    updatedAt: user.updated_at,
    message: 'User disabled'
  })

  if (session.device_id) {
    const device = db
      .prepare('SELECT status, updated_at FROM user_devices WHERE user_id = ? AND device_id = ? LIMIT 1')
      .get(user.id, session.device_id) as { status: string, updated_at: string } | undefined
    if (!device) {
      throw createError({ statusCode: 403, statusMessage: 'Device disabled' })
    }
    assertActiveOrWithinGrace({
      status: device.status,
      updatedAt: device.updated_at,
      message: 'Device disabled'
    })
  }

  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), session.id)

  return {
    user,
    sessionId: session.id,
    deviceId: session.device_id
  }
}

export function requireAdmin(event: H3Event) {
  const auth = requireAuth(event)
  if (auth.user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Admin permission required' })
  }
  return auth
}

export function createSession(event: H3Event, input: {
  userId: string
  deviceId?: string
}) {
  const token = randomToken()
  const timestamp = nowIso()
  const expiresAt = NON_EXPIRING_SESSION_EXPIRES_AT
  const sessionId = randomUUID()

  getDb()
    .prepare(`
      INSERT INTO sessions
        (id, user_id, token_hash, device_id, expires_at, revoked_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `)
    .run(sessionId, input.userId, hashToken(token), input.deviceId || null, expiresAt, timestamp, timestamp)

  setSessionCookie(event, token)

  return {
    token,
    expiresAt,
    sessionId
  }
}

export function registerOrUpdateDevice(input: {
  userId: string
  deviceId: string
  deviceName?: string
  os?: string
  clientVersion?: string
  allowDisabledGrace?: boolean
}) {
  const settings = getAppSettings()
  const db = getDb()
  const timestamp = nowIso()
  const existing = db
    .prepare('SELECT id, status, updated_at FROM user_devices WHERE user_id = ? AND device_id = ? LIMIT 1')
    .get(input.userId, input.deviceId) as { id: string, status: string, updated_at: string } | undefined

  if (!existing) {
    const count = db
      .prepare('SELECT COUNT(*) AS count FROM user_devices WHERE user_id = ?')
      .get(input.userId) as { count: number }
    if (count.count >= settings.maxDevicesPerUser) {
      throw createError({ statusCode: 403, statusMessage: 'Device limit reached' })
    }
  } else if (
    existing.status !== 'active'
    && (!input.allowDisabledGrace || isDisabledExpired(existing.updated_at))
  ) {
    throw createError({ statusCode: 403, statusMessage: 'Device disabled' })
  }

  db.prepare(`
    INSERT INTO user_devices
      (id, user_id, device_id, device_name, os, client_version, status, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(user_id, device_id) DO UPDATE SET
      device_name = excluded.device_name,
      os = excluded.os,
      client_version = excluded.client_version,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `).run(
    randomUUID(),
    input.userId,
    input.deviceId,
    input.deviceName || '',
    input.os || '',
    input.clientVersion || '',
    timestamp,
    timestamp,
    timestamp
  )

  if (settings.restrictConcurrentDevices) {
    const activeSessions = db
      .prepare(`
        SELECT id FROM sessions
        WHERE user_id = ?
          AND revoked_at IS NULL
        ORDER BY last_seen_at DESC
      `)
      .all(input.userId) as Array<{ id: string }>
    const sessionsToRevoke = activeSessions.slice(settings.maxConcurrentDevices)
    const revoke = db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')
    for (const session of sessionsToRevoke) {
      revoke.run(timestamp, session.id)
    }
  }
}

export function revokeSession(event: H3Event) {
  const token = getSessionToken(event)
  if (token) {
    getDb()
      .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?')
      .run(nowIso(), hashToken(token))
  }
  clearSessionCookie(event)
}
