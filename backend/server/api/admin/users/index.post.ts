import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { getDb, nowIso } from '../../../utils/db'
import { hashPassword } from '../../../utils/crypto'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { optionalString, requiredString } from '../../../utils/http'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const body = await readJsonBody<{
    account?: string
    password?: string
    displayName?: string
    email?: string
    phone?: string
    role?: string
  }>(event)
  const account = requiredString(body.account, 'account', 128)
  const password = requiredString(body.password, 'password', 256)
  const displayName = optionalString(body.displayName, 128) || account
  const role = body.role === 'admin' ? 'admin' : 'user'
  const db = getDb()
  const exists = db.prepare('SELECT id FROM users WHERE account = ? LIMIT 1').get(account)
  if (exists) {
    throw createError({ statusCode: 409, statusMessage: 'Account already exists' })
  }
  const timestamp = nowIso()
  const userId = randomUUID()
  db.prepare(`
    INSERT INTO users
      (id, account, email, phone, display_name, password_hash, role, status, last_login_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)
  `).run(
    userId,
    account,
    optionalString(body.email, 256),
    optionalString(body.phone, 64),
    displayName,
    hashPassword(password),
    role,
    timestamp,
    timestamp
  )

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.users.create',
    targetType: 'user',
    targetId: userId
  })

  return {
    success: true,
    data: { id: userId }
  }
})

