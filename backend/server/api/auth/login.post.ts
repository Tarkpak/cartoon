import { createError } from 'h3'
import { getDb, nowIso } from '../../utils/db'
import { verifyPassword } from '../../utils/crypto'
import { createSession, publicUser, readJsonBody, registerOrUpdateDevice } from '../../utils/auth'
import { optionalString, requiredString } from '../../utils/http'
import { writeAudit } from '../../utils/audit'

interface LoginUserRow {
  id: string
  account: string
  display_name: string
  password_hash: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
}

export default defineEventHandler(async (event) => {
  const body = await readJsonBody<{
    account?: string
    password?: string
    deviceId?: string
    deviceName?: string
    os?: string
    clientVersion?: string
  }>(event)
  const account = requiredString(body.account, 'account', 128)
  const password = requiredString(body.password, 'password', 256)
  const db = getDb()
  const user = db
    .prepare('SELECT id, account, display_name, password_hash, role, status FROM users WHERE account = ? LIMIT 1')
    .get(account) as LoginUserRow | undefined

  if (!user || !verifyPassword(password, user.password_hash)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid account or password' })
  }
  if (user.status !== 'active') {
    throw createError({ statusCode: 403, statusMessage: 'User disabled' })
  }

  const deviceId = optionalString(body.deviceId, 128)
  if (deviceId) {
    registerOrUpdateDevice({
      userId: user.id,
      deviceId,
      deviceName: optionalString(body.deviceName, 128),
      os: optionalString(body.os, 64),
      clientVersion: optionalString(body.clientVersion, 64)
    })
  }

  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .run(nowIso(), nowIso(), user.id)
  const session = createSession(event, { userId: user.id, deviceId: deviceId || undefined })

  writeAudit(event, {
    actorUserId: user.id,
    action: 'auth.login',
    targetType: 'user',
    targetId: user.id,
    metadata: { deviceId: deviceId || null }
  })

  return {
    success: true,
    data: {
      user: publicUser(user),
      token: session.token,
      expiresAt: session.expiresAt
    }
  }
})

