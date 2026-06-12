import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { getDb, nowIso } from '../../utils/db'
import { hashPassword } from '../../utils/crypto'
import { readJsonBody, setSessionCookie, createSession, publicUser } from '../../utils/auth'
import { requiredString, optionalString } from '../../utils/http'
import { writeAudit } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
    .get() as { count: number }
  if (count.count > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Admin already initialized' })
  }

  const body = await readJsonBody<{
    account?: string
    password?: string
    displayName?: string
  }>(event)
  const account = requiredString(body.account, 'account', 128)
  const password = requiredString(body.password, 'password', 256)
  const displayName = optionalString(body.displayName, 128) || account
  const timestamp = nowIso()
  const userId = randomUUID()

  db.prepare(`
    INSERT INTO users
      (id, account, email, phone, display_name, password_hash, role, status, last_login_at, created_at, updated_at)
    VALUES (?, ?, '', '', ?, ?, 'admin', 'active', ?, ?, ?)
  `).run(userId, account, displayName, hashPassword(password), timestamp, timestamp, timestamp)

  const session = createSession(event, { userId })
  setSessionCookie(event, session.token)
  const user = db
    .prepare('SELECT id, account, display_name, role, status FROM users WHERE id = ?')
    .get(userId) as Parameters<typeof publicUser>[0]

  writeAudit(event, {
    actorUserId: userId,
    action: 'setup.initialize_admin',
    targetType: 'user',
    targetId: userId
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

