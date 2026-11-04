import { getQuery } from 'h3'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { pagination, type SqlBinding } from '../../utils/http'

export default defineEventHandler(event => {
  requireAdmin(event)
  const db = getDb()
  const query = getQuery(event)
  const { page, pageSize, offset } = pagination(event)
  const parts: string[] = []
  const params: SqlBinding[] = []
  for (const [key, column] of [['runId', 'r.id'], ['userId', 'r.user_id'], ['projectId', 'r.project_id'], ['status', 'r.status']] as const) {
    if (query[key]) { parts.push(`${column}=?`); params.push(String(query[key])) }
  }
  if (query.skill) {
    parts.push(`EXISTS (SELECT 1 FROM json_each(r.body_json,'$.skills') s WHERE instr(lower(json_extract(s.value,'$.name')), lower(?))>0 OR json_extract(s.value,'$.id')=?)`)
    params.push(String(query.skill), String(query.skill))
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : ''
  const total = db.prepare(`SELECT count(*) AS count FROM skill_runs r ${where}`).get(...params) as { count: number }
  const rows = db.prepare(`SELECT r.body_json, r.user_id, u.account, u.display_name,
    (SELECT count(*) FROM model_call_logs l WHERE l.archived_at IS NULL AND l.user_id=r.user_id AND json_extract(l.skill_context_json,'$.runId')=r.id) AS modelCallCount
    FROM skill_runs r LEFT JOIN users u ON u.id=r.user_id ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`).all(...params,pageSize,offset) as Array<{ body_json: string, user_id: string, account: string, display_name: string, modelCallCount: number }>
  return { success: true, data: { runs: rows.map(({body_json, ...row}) => ({...JSON.parse(body_json), ...row})), pagination: { page, pageSize, total: total.count } } }
})
