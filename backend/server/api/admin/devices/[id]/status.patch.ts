import { createError } from 'h3'
import { getDb, nowIso } from '../../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { requiredParam } from '../../../../utils/http'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const deviceRecordId = requiredParam(event, 'id')
  const body = await readJsonBody<{ status?: string }>(event)
  const status = body.status === 'disabled' ? 'disabled' : 'active'
  const result = getDb()
    .prepare('UPDATE user_devices SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, nowIso(), deviceRecordId)
  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Device not found' })
  }
  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.devices.status',
    targetType: 'device',
    targetId: deviceRecordId,
    metadata: { status }
  })
  return { success: true }
})
