import { createError } from 'h3'
import { getDb, nowIso } from '../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { requiredParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const body = await readJsonBody<{
    displayName?: string
    email?: string
    phone?: string
    role?: string
  }>(event)

  const updates: string[] = []
  const params: any[] = []

  if (body.displayName !== undefined) {
    updates.push('display_name = ?')
    params.push(body.displayName.trim())
  }

  if (body.email !== undefined) {
    updates.push('email = ?')
    params.push(body.email.trim() || null)
  }

  if (body.phone !== undefined) {
    updates.push('phone = ?')
    params.push(body.phone.trim() || null)
  }

  if (body.role !== undefined) {
    if (!['user', 'admin'].includes(body.role)) {
      throw createError({ statusCode: 400, statusMessage: '无效的角色' })
    }
    updates.push('role = ?')
    params.push(body.role)
  }

  if (updates.length === 0) {
    throw createError({ statusCode: 400, statusMessage: '没有可更新的字段' })
  }

  updates.push('updated_at = ?')
  params.push(nowIso(), userId)

  const result = getDb()
    .prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .run(...params)

  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.users.update',
    targetType: 'user',
    targetId: userId,
    metadata: body
  })

  return { success: true }
})
