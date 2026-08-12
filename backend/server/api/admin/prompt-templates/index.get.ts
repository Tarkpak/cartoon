import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const templates = db
    .prepare(`
      SELECT template_key, title, content, updated_at
      FROM system_prompt_templates
      ORDER BY template_key ASC
    `)
    .all()

  return {
    success: true,
    data: { templates }
  }
})
