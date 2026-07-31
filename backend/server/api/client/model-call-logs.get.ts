import { getDb } from '../../utils/db'
import { requireAuth } from '../../utils/auth'
import { pagination } from '../../utils/http'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const { page, pageSize, offset } = pagination(event)
  if (auth.user.role !== 'admin') {
    return {
      success: true,
      data: { modelCallLogs: [], pagination: { page, pageSize, total: 0, totalPages: 1 } }
    }
  }

  const db = getDb()
  const total = db.prepare(
    'SELECT COUNT(*) AS count FROM model_call_logs WHERE archived_at IS NULL'
  ).get() as { count: number }
  const logs = db.prepare(`
    SELECT l.*, u.account AS owner_account, u.display_name AS owner_display_name
    FROM model_call_logs l
    JOIN users u ON u.id = l.user_id
    WHERE l.archived_at IS NULL
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset)

  return {
    success: true,
    data: {
      modelCallLogs: logs,
      pagination: {
        page,
        pageSize,
        total: total.count,
        totalPages: Math.max(1, Math.ceil(total.count / pageSize))
      }
    }
  }
})
