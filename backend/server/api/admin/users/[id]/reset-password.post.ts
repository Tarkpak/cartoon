import { createError } from 'h3'
import { hash } from 'bcrypt'
import { getDb, nowIso } from '../../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { requiredParam } from '../../../../utils/http'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const body = await readJsonBody<{ password?: string }>(event)

  if (!body.password || body.password.length < 6) {
    throw createError({ statusCode: 400, statusMessage: '密码长度至少为 6 位' })
  }

  const passwordHash = await hash(body.password, 10)
  const result = getDb()
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(passwordHash, nowIso(), userId)

  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.users.reset_password',
    targetType: 'user',
    targetId: userId,
    metadata: {}
  })

  return { success: true }
})
