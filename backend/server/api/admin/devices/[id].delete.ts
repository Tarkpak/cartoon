import { createError } from 'h3'
import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { requiredParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const deviceRecordId = requiredParam(event, 'id')
  const db = getDb()

  // 获取设备信息用于审计
  const device = db
    .prepare('SELECT user_id, device_id, device_name FROM user_devices WHERE id = ?')
    .get(deviceRecordId) as { user_id: string, device_id: string, device_name: string } | undefined

  if (!device) {
    throw createError({ statusCode: 404, statusMessage: 'Device not found' })
  }

  const result = db
    .prepare('DELETE FROM user_devices WHERE id = ?')
    .run(deviceRecordId)

  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Device not found' })
  }

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.devices.delete',
    targetType: 'device',
    targetId: deviceRecordId,
    metadata: {
      userId: device.user_id,
      deviceId: device.device_id,
      deviceName: device.device_name
    }
  })

  return { success: true }
})
