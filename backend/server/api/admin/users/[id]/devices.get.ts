import { getDb } from '../../../../utils/db'
import { requireAdmin } from '../../../../utils/auth'
import { requiredParam } from '../../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const devices = getDb()
    .prepare(`
      SELECT id, device_id, device_name, os, client_version, status, last_seen_at, created_at, updated_at
      FROM user_devices
      WHERE user_id = ?
      ORDER BY last_seen_at DESC
    `)
    .all(userId)
  return {
    success: true,
    data: { devices }
  }
})
