import { getQuery } from 'h3'
import { getDb, parseJsonText } from '../../../../utils/db'
import { requireAdmin } from '../../../../utils/auth'
import { pagination, type SqlBinding, requiredParam } from '../../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)
  const query = getQuery(event)
  const keyword = String(query.keyword || '').trim()
  const params: SqlBinding[] = []
  let where = 'WHERE (a.actor_user_id = ? OR a.target_id = ?)'
  params.push(userId, userId)

  if (keyword) {
    where += ' AND (a.action LIKE ? OR a.target_type LIKE ?)'
    const value = `%${keyword}%`
    params.push(value, value)
  }

  const total = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM audit_logs a
      ${where}
    `)
    .get(...params) as { count: number }

  const logs = db
    .prepare(`
      SELECT a.id, a.actor_user_id, u.account AS actor_account, u.display_name AS actor_display_name,
             a.action, a.target_type, a.target_id,
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
