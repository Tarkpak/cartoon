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
    where = 'WHERE account LIKE ? OR display_name LIKE ? OR email LIKE ? OR phone LIKE ?'
    const value = `%${keyword}%`
    params.push(value, value, value, value)
  }

  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM users ${where}`)
    .get(...params) as { count: number }
  const users = db
    .prepare(`
      SELECT id, account, email, phone, display_name, role, status, last_login_at, created_at, updated_at
      FROM users
      ${where}
      ORDER BY created_at DESC
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
