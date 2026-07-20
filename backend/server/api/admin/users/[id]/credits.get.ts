import { getQuery } from 'h3'
import { assertUserExists, creditDateBounds, getCreditAccount } from '../../../../utils/credits'
import { getDb, parseJsonText } from '../../../../utils/db'
import { requireAdmin } from '../../../../utils/auth'
import { pagination, requiredParam } from '../../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  assertUserExists(userId)
  const { page, pageSize, offset } = pagination(event)
  const query = getQuery(event)
  const type = String(query.type || '').trim()
  const params: Array<string | number> = [userId]
  const clauses: string[] = []
  if (type) {
    clauses.push('type = ?')
    params.push(type)
  }
  const startDate = String(query.startDate || '').trim()
  const endDate = String(query.endDate || '').trim()
  const { startAt, endAt } = creditDateBounds(startDate, endDate)
  if (startAt) {
    clauses.push('created_at >= ?')
    params.push(startAt)
  }
  if (endAt) {
    clauses.push('created_at < ?')
    params.push(endAt)
  }
  const filterClause = clauses.length ? `AND ${clauses.join(' AND ')}` : ''
  const db = getDb()
  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM credit_transactions
    WHERE user_id = ? ${filterClause}
  `).get(...params) as { count: number }
  const period = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS added,
      COALESCE(SUM(CASE WHEN type = 'admin_deduct' THEN -amount ELSE 0 END), 0) AS deducted,
      COALESCE(SUM(CASE WHEN type = 'model_call' THEN -amount ELSE 0 END), 0) AS consumed
    FROM credit_transactions
    WHERE user_id = ? ${filterClause}
  `).get(...params) as { added: number, deducted: number, consumed: number }
  const rows = db.prepare(`
    SELECT id, type, amount, balance_after, reason, operation, provider, model_id,
           model_call_log_id, actor_user_id, metadata_json, created_at
    FROM credit_transactions
    WHERE user_id = ? ${filterClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as Array<Record<string, unknown> & { metadata_json?: string }>

  return {
    success: true,
    data: {
      account: getCreditAccount(userId),
      period: { ...period, transactionCount: total.count },
      transactions: rows.map(row => ({
        ...row,
        metadata: parseJsonText(row.metadata_json, {})
      })),
      pagination: { page, pageSize, total: total.count }
    }
  }
})
