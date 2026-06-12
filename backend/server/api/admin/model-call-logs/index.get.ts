import { getQuery } from 'h3'
import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { pagination, type SqlBinding } from '../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)
  const query = getQuery(event)
  const params: SqlBinding[] = []
  const whereParts = ['l.archived_at IS NULL']

  for (const [field, column] of [
    ['userId', 'l.user_id'],
    ['provider', 'l.provider'],
    ['modelId', 'l.model_id'],
    ['operation', 'l.operation'],
    ['status', 'l.status']
  ] as const) {
    const value = String(query[field] || '').trim()
    if (value) {
      whereParts.push(`${column} = ?`)
      params.push(value)
    }
  }

  const keyword = String(query.keyword || '').trim()
  if (keyword) {
    whereParts.push('(l.request_id LIKE ? OR l.error_message LIKE ? OR u.account LIKE ? OR u.display_name LIKE ?)')
    const value = `%${keyword}%`
    params.push(value, value, value, value)
  }

  const where = `WHERE ${whereParts.join(' AND ')}`
  const total = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM model_call_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ${where}
    `)
    .get(...params) as { count: number }
  const logs = db
    .prepare(`
      SELECT l.id, l.user_id, u.account, u.display_name, l.request_id, l.provider, l.model_id,
             l.operation, l.project_id, l.scene_id, l.status, l.duration_ms, l.estimated_cost,
             l.error_message, l.created_at
      FROM model_call_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ${where}
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, pageSize, offset)

  return {
    success: true,
    data: {
      logs,
      pagination: {
        page,
        pageSize,
        total: total.count
      }
    }
  }
})
