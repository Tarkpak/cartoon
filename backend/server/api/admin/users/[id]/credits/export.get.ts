import { getQuery, setHeader } from 'h3'
import { assertUserExists, creditDateBounds } from '../../../../../utils/credits'
import { getDb } from '../../../../../utils/db'
import { requireAdmin } from '../../../../../utils/auth'
import { requiredParam } from '../../../../../utils/http'

function csvCell(value: unknown) {
  const raw = value == null ? '' : String(value)
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${text.replace(/"/g, '""')}"`
}

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  assertUserExists(userId)
  const query = getQuery(event)
  const params: Array<string> = [userId]
  const clauses: string[] = []
  const type = String(query.type || '').trim()
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
  const rows = getDb().prepare(`
    SELECT type, amount, balance_after, reason, operation, provider, model_id, created_at
    FROM credit_transactions
    WHERE user_id = ? ${filterClause}
    ORDER BY created_at DESC, id DESC
  `).all(...params) as Array<Record<string, unknown>>
  const headers = ['类型', '积分变动', '变动后余额', '原因', '操作', '供应商', '模型', '时间']
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push([
      row.type, row.amount, row.balance_after, row.reason, row.operation,
      row.provider, row.model_id, row.created_at
    ].map(csvCell).join(','))
  }
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename="credits.csv"')
  return `\uFEFF${lines.join('\n')}`
})
