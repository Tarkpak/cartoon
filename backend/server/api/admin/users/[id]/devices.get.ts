import { getDb } from '../../../../utils/db'
import { requireAdmin } from '../../../../utils/auth'
import { requiredParam, pagination } from '../../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)

  const total = db
    .prepare('SELECT COUNT(*) AS count FROM user_devices WHERE user_id = ?')
    .get(userId) as { count: number }

  const devices = db
    .prepare(`
      SELECT id, device_id, device_name, os, client_version, status, last_seen_at, created_at, updated_at
      FROM user_devices
      WHERE user_id = ?
      ORDER BY last_seen_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(userId, pageSize, offset)

  return {
    success: true,
    data: {
      devices,
      pagination: {
        page,
        pageSize,
        total: total.count
      }
    }
  }
})
