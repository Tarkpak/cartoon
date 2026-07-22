import { getQuery } from 'h3'
import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { pagination, type SqlBinding } from '../../../utils/http'

const filterFields = [
  ['userId', 'l.user_id'],
  ['provider', 'l.provider'],
  ['modelId', 'l.model_id'],
  ['operation', 'l.operation'],
  ['status', 'l.status']
] as const

const sortColumns = {
  createdAt: 'l.created_at',
  duration: 'l.duration_ms',
  cost: 'l.estimated_cost',
  credits: 'l.credits_charged'
} as const

function numberQuery(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)
  const query = getQuery(event)
  const params: SqlBinding[] = []
  const whereParts = ['l.archived_at IS NULL']

  for (const [field, column] of filterFields) {
    const value = String(query[field] || '').trim()
    if (value) {
      whereParts.push(`${column} = ?`)
      params.push(value)
    }
  }

  const keyword = String(query.keyword || '').trim()
  if (keyword) {
    whereParts.push(`(
      l.request_id LIKE ? OR l.error_message LIKE ? OR u.account LIKE ? OR u.display_name LIKE ?
      OR l.model_id LIKE ? OR l.project_id LIKE ? OR l.scene_id LIKE ?
    )`)
    const value = `%${keyword}%`
    params.push(value, value, value, value, value, value, value)
  }

  const startAt = String(query.startAt || '').trim()
  const endAt = String(query.endAt || '').trim()
  if (startAt) {
    whereParts.push('l.created_at >= ?')
    params.push(startAt)
  }
  if (endAt) {
    whereParts.push('l.created_at <= ?')
    params.push(endAt)
  }

  const minDuration = numberQuery(query.minDuration)
  const maxDuration = numberQuery(query.maxDuration)
  if (minDuration !== null) {
    whereParts.push('l.duration_ms >= ?')
    params.push(minDuration)
  }
  if (maxDuration !== null) {
    whereParts.push('l.duration_ms <= ?')
    params.push(maxDuration)
  }

  const where = `WHERE ${whereParts.join(' AND ')}`
  const sortBy = String(query.sortBy || 'createdAt') as keyof typeof sortColumns
  const sortColumn = sortColumns[sortBy] || sortColumns.createdAt
  const sortDirection = String(query.sortOrder || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC'

  const summary = db
    .prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN l.status IN ('failed', 'error') THEN 1 ELSE 0 END) AS failed,
        COALESCE(AVG(l.duration_ms), 0) AS average_duration,
        COALESCE(SUM(l.estimated_cost), 0) AS total_cost,
        COALESCE(SUM(l.credits_charged), 0) AS total_credits
      FROM model_call_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ${where}
    `)
    .get(...params) as Record<string, number>

  const logs = db
    .prepare(`
      SELECT l.id, l.user_id, u.account, u.display_name, l.request_id, l.provider, l.model_id,
             l.operation, l.project_id, l.scene_id, l.status, l.duration_ms, l.estimated_cost,
             l.credits_charged, l.error_message, l.created_at
      FROM model_call_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ${where}
      ORDER BY ${sortColumn} ${sortDirection}, l.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, pageSize, offset)

  const includeOptions = String(query.includeOptions || 'true') !== 'false'
  const options = includeOptions
    ? {
        users: db.prepare(`
          SELECT DISTINCT l.user_id AS value, COALESCE(u.display_name, u.account, l.user_id) AS label
          FROM model_call_logs l LEFT JOIN users u ON u.id = l.user_id
          WHERE l.archived_at IS NULL AND l.user_id IS NOT NULL
          ORDER BY label
        `).all(),
        providers: db.prepare(`SELECT DISTINCT provider AS value FROM model_call_logs WHERE archived_at IS NULL AND provider <> '' ORDER BY provider`).all(),
        models: db.prepare(`SELECT DISTINCT model_id AS value FROM model_call_logs WHERE archived_at IS NULL AND model_id <> '' ORDER BY model_id`).all(),
        operations: db.prepare(`SELECT DISTINCT operation AS value FROM model_call_logs WHERE archived_at IS NULL AND operation <> '' ORDER BY operation`).all(),
        statuses: db.prepare(`SELECT DISTINCT status AS value FROM model_call_logs WHERE archived_at IS NULL AND status <> '' ORDER BY status`).all()
      }
    : null

  return {
    success: true,
    data: {
      logs,
      summary: {
        total: Number(summary.total || 0),
        failed: Number(summary.failed || 0),
        averageDuration: Number(summary.average_duration || 0),
        totalCost: Number(summary.total_cost || 0),
        totalCredits: Number(summary.total_credits || 0)
      },
      options,
      pagination: { page, pageSize, total: Number(summary.total || 0) }
    }
  }
})
