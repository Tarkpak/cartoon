import { createError } from 'h3'
import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { requiredParam } from '../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const db = getDb()
  const user = db
    .prepare(`
      SELECT id, account, email, phone, display_name, role, status, last_login_at, created_at, updated_at
      FROM users WHERE id = ? LIMIT 1
    `)
    .get(userId) as Record<string, unknown> | undefined
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  const projectCount = db.prepare('SELECT COUNT(*) AS count FROM user_projects WHERE user_id = ?').get(userId) as { count: number }
  const promptTemplateCount = db.prepare('SELECT COUNT(*) AS count FROM user_prompt_templates WHERE user_id = ?').get(userId) as { count: number }
  const preferenceCount = db.prepare('SELECT COUNT(*) AS count FROM user_model_preferences WHERE user_id = ?').get(userId) as { count: number }
  const logCount = db.prepare('SELECT COUNT(*) AS count FROM model_call_logs WHERE user_id = ?').get(userId) as { count: number }

  return {
    success: true,
    data: {
      user,
      stats: {
        projectCount: projectCount.count,
        promptTemplateCount: promptTemplateCount.count,
        preferenceCount: preferenceCount.count,
        logCount: logCount.count
      }
    }
  }
})
