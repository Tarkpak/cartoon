import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { Database } from 'bun:sqlite'

export const PROJECT_EDIT_LEASE_MS = 90_000

interface Lease {
  owner_user_id: string
  local_project_id: string
  user_id: string
  device_id: string
  session_id: string
  token: string
  expires_at: number
}

export function ensureProjectEditLeaseSchema(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS project_edit_leases (
    owner_user_id TEXT NOT NULL, local_project_id TEXT NOT NULL,
    user_id TEXT NOT NULL, device_id TEXT NOT NULL, session_id TEXT NOT NULL,
    token TEXT NOT NULL, expires_at INTEGER NOT NULL,
    PRIMARY KEY(owner_user_id, local_project_id)
  )`)
}

export function projectEditLease(db: Database, ownerUserId: string, localProjectId: string): Lease | null {
  return db.query('SELECT * FROM project_edit_leases WHERE owner_user_id = ? AND local_project_id = ?')
    .get(ownerUserId, localProjectId) as Lease | null
}

export function operateProjectEditLease(db: Database, input: {
  ownerUserId: string
  localProjectId: string
  userId: string
  deviceId: string
  sessionId: string
  token?: string
  action: 'acquire' | 'heartbeat' | 'release' | 'check' | 'takeover'
  canTakeover: boolean
  nowMs?: number
}) {
  return db.transaction(() => {
    const now = input.nowMs ?? Date.now()
    const current = projectEditLease(db, input.ownerUserId, input.localProjectId)
    const active = current && current.expires_at > now ? current : null
    const sameSession = active?.user_id === input.userId && active.device_id === input.deviceId && active.session_id === input.sessionId
    const owns = sameSession && active?.token === input.token
    if (input.action === 'takeover' && !input.canTakeover) throw createError({ statusCode: 403, message: '仅项目所有者或管理员可以接管编辑权' })
    if (input.action === 'release') {
      if (owns) db.query('DELETE FROM project_edit_leases WHERE owner_user_id = ? AND local_project_id = ? AND token = ?')
        .run(input.ownerUserId, input.localProjectId, input.token!)
      return { editable: false, lease: owns ? null : active }
    }
    if (input.action === 'check') return { editable: !!owns, lease: active }
    if (input.action === 'heartbeat' && !owns) return { editable: false, lease: active }
    if (active && !owns && input.action !== 'takeover') return { editable: false, lease: active }
    const token = owns ? active!.token : randomUUID()
    db.query(`INSERT INTO project_edit_leases (owner_user_id, local_project_id, user_id, device_id, session_id, token, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_user_id, local_project_id) DO UPDATE SET
      user_id = excluded.user_id, device_id = excluded.device_id, session_id = excluded.session_id, token = excluded.token, expires_at = excluded.expires_at`)
      .run(input.ownerUserId, input.localProjectId, input.userId, input.deviceId, input.sessionId, token, now + PROJECT_EDIT_LEASE_MS)
    return { editable: true, lease: projectEditLease(db, input.ownerUserId, input.localProjectId) }
  })()
}

export function requireProjectEditLease(db: Database, input: {
  ownerUserId: string, localProjectId: string, userId: string, token?: string | null, nowMs?: number
}) {
  const lease = projectEditLease(db, input.ownerUserId, input.localProjectId)
  if (!lease || lease.expires_at <= (input.nowMs ?? Date.now()) || lease.user_id !== input.userId || lease.token !== input.token) {
    throw createError({ statusCode: 423, message: '项目编辑权已失效，请重新取得编辑权后同步' })
  }
}
