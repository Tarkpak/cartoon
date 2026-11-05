import { getDb } from '../../utils/db'
import { requireAuth } from '../../utils/auth'
import { pagination } from '../../utils/http'

export default defineEventHandler((event) => {
  const { user } = requireAuth(event)
  const { page, pageSize, offset } = pagination(event)
  const db = getDb()
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM model_usage_records WHERE user_id=?').get(user.id) as { count: number }
  const rows = db.prepare('SELECT record_json FROM model_usage_records WHERE user_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?')
    .all(user.id, pageSize, offset) as Array<{ record_json: string }>
  return { success: true, data: { records: rows.map(row => JSON.parse(row.record_json)), page, totalPages: Math.max(1, Math.ceil(count / pageSize)) } }
})
