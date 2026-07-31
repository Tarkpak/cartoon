import { getDb, parseJsonText } from '../../utils/db'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const db = getDb()
  const preferences = db.prepare(`
    SELECT workflow_step, model_id, model_options_json, updated_at
    FROM user_model_preferences
    WHERE user_id = ?
    ORDER BY workflow_step ASC
  `).all(auth.user.id) as Array<{
    workflow_step: string
    model_id: string
    model_options_json: string | null
    updated_at: string
  }>

  return {
    success: true,
    data: {
      modelPreferences: preferences.map(preference => ({
        workflowStep: preference.workflow_step,
        modelId: preference.model_id,
        modelOptions: parseJsonText(preference.model_options_json, {}),
        updatedAt: preference.updated_at
      }))
    }
  }
})
