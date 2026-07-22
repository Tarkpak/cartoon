import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { pagination } from '../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)
  const total = db.prepare('SELECT COUNT(*) AS count FROM log_archives').get() as { count: number }
  const archives = db.prepare(`
    SELECT id, archive_type, row_count, created_at
    FROM log_archives
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset)

  return {
    success: true,
    data: {
      archives,
      pagination: { page, pageSize, total: total.count }
    }
  }
})
