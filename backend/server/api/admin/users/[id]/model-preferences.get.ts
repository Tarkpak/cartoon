import { getDb, parseJsonText } from '../../../../utils/db'
import { requireAdmin } from '../../../../utils/auth'
import { requiredParam } from '../../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const preferences = getDb()
    .prepare(`
      SELECT id, workflow_step, model_id, model_options_json, created_at, updated_at
      FROM user_model_preferences
      WHERE user_id = ?
      ORDER BY workflow_step ASC
    `)
    .all(userId) as Array<Record<string, unknown> & { model_options_json?: string }>

  return {
    success: true,
    data: {
      preferences: preferences.map(preference => ({
        ...preference,
        modelOptions: parseJsonText(preference.model_options_json, {})
      }))
    }
  }
})
