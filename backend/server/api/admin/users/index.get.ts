import { getQuery } from 'h3'
import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { pagination, type SqlBinding } from '../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)
  const query = getQuery(event)
  const keyword = String(query.keyword || '').trim()
  const params: SqlBinding[] = []
  let where = ''
  if (keyword) {
    where = 'WHERE u.account LIKE ? OR u.display_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?'
    const value = `%${keyword}%`
    params.push(value, value, value, value)
  }

  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM users u ${where}`)
    .get(...params) as { count: number }
  const users = db
    .prepare(`
      SELECT u.id, u.account, u.email, u.phone, u.display_name, u.role, u.status,
             u.last_login_at, u.created_at, u.updated_at,
             COALESCE(c.balance, 0) AS credit_balance,
             COALESCE(c.total_consumed, 0) AS credits_consumed
      FROM users u
      LEFT JOIN credit_accounts c ON c.user_id = u.id
      ${where}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, pageSize, offset)

  return {
    success: true,
    data: {
      users,
      pagination: {
        page,
        pageSize,
        total: total.count
      }
    }
  }
})
