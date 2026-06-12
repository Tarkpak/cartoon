import { createError } from 'h3'
import { getDb, nowIso } from '../../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { requiredParam } from '../../../../utils/http'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const body = await readJsonBody<{ status?: string }>(event)
  const status = body.status === 'disabled' ? 'disabled' : 'active'
  const result = getDb()
    .prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, nowIso(), userId)
  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }
  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.users.status',
    targetType: 'user',
    targetId: userId,
    metadata: { status }
  })
  return { success: true }
})
