import { getDb, nowIso } from '../../../utils/db'
import { requireAdmin, readJsonBody } from '../../../utils/auth'
import { requiredParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = requiredParam(event, 'id')
  const body = await readJsonBody<Record<string, unknown>>(event)
  const action = body.action === 'restore' ? 'restore' : body.action === 'delete' ? 'delete' : ''
  if (!action) throw createError({ statusCode: 400, statusMessage: 'action is invalid' })
  const timestamp = nowIso()
  const changed = getDb().prepare(`
    UPDATE library_assets SET deleted_at = ?, local_updated_at = ?, updated_at = ? WHERE id = ?
  `).run(action === 'delete' ? timestamp : null, timestamp, timestamp, id)
  if (changed.changes === 0) throw createError({ statusCode: 404, statusMessage: 'library asset not found' })
  return { success: true }
})
