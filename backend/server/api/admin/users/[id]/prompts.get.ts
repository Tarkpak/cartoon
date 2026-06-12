import { getDb, parseJsonText } from '../../../../utils/db'
import { requireAdmin } from '../../../../utils/auth'
import { requiredParam } from '../../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const db = getDb()
  const state = db
    .prepare('SELECT snapshot_json, updated_at FROM user_prompt_state WHERE user_id = ? LIMIT 1')
    .get(userId) as { snapshot_json: string, updated_at: string } | undefined
  const profiles = db
    .prepare(`
      SELECT id, local_profile_id, name, description, is_active, created_at, updated_at
      FROM user_prompt_profiles
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `)
    .all(userId)
  const templates = db
    .prepare(`
      SELECT id, profile_id, local_template_id, template_key, title, content, source, created_at, updated_at
      FROM user_prompt_templates
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `)
    .all(userId)

  return {
    success: true,
    data: {
      state: state
        ? {
            snapshot: parseJsonText(state.snapshot_json, {}),
            updatedAt: state.updated_at
          }
        : null,
      profiles,
      templates
    }
  }
})
