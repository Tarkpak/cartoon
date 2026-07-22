import { getQuery } from 'h3'
import { getDb, parseJsonText } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { pagination, type SqlBinding } from '../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)
  const query = getQuery(event)
  const keyword = String(query.keyword || '').trim()
  const params: SqlBinding[] = []
  const whereParts: string[] = []
  if (keyword) {
    whereParts.push('(a.action LIKE ? OR a.target_type LIKE ? OR a.target_id LIKE ? OR u.account LIKE ? OR u.display_name LIKE ?)')
    const value = `%${keyword}%`
    params.push(value, value, value, value, value)
  }
  const startAt = String(query.startAt || '').trim()
  const endAt = String(query.endAt || '').trim()
  if (startAt) {
    whereParts.push('a.created_at >= ?')
    params.push(startAt)
  }
  if (endAt) {
    whereParts.push('a.created_at <= ?')
    params.push(endAt)
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''
  const total = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ${where}
    `)
    .get(...params) as { count: number }
  const logs = db
    .prepare(`
      SELECT a.id, a.actor_user_id, u.account, u.display_name, a.action, a.target_type, a.target_id,
             a.metadata_json, a.ip, a.user_agent, a.created_at
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, pageSize, offset) as Array<Record<string, unknown> & { metadata_json?: string }>

  return {
    success: true,
    data: {
      logs: logs.map(log => ({
        ...log,
        metadata: parseJsonText(log.metadata_json, {})
      })),
      pagination: {
        page,
        pageSize,
        total: total.count
      }
    }
  }
})
