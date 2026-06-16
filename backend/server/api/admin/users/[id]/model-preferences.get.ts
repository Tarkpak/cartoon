import { getDb, parseJsonText } from '../../../../utils/db'
import { requireAdmin } from '../../../../utils/auth'
import { requiredParam, pagination } from '../../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)

  const total = db
    .prepare('SELECT COUNT(*) AS count FROM user_model_preferences WHERE user_id = ?')
    .get(userId) as { count: number }

  const preferences = db
    .prepare(`
      SELECT id, workflow_step, model_id, model_options_json, created_at, updated_at
      FROM user_model_preferences
      WHERE user_id = ?
      ORDER BY workflow_step ASC
      LIMIT ? OFFSET ?
    `)
    .all(userId, pageSize, offset) as Array<Record<string, unknown> & { model_options_json?: string }>

  return {
    success: true,
    data: {
      preferences: preferences.map(preference => ({
        ...preference,
        modelOptions: parseJsonText(preference.model_options_json, {})
      })),
      pagination: {
        page,
        pageSize,
        total: total.count
      }
    }
  }
})
