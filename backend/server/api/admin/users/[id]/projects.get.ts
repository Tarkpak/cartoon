import { getDb, parseJsonText } from '../../../../utils/db'
import { requireAdmin } from '../../../../utils/auth'
import { requiredParam, pagination } from '../../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)

  const total = db
    .prepare('SELECT COUNT(*) AS count FROM user_projects WHERE user_id = ?')
    .get(userId) as { count: number }

  const projects = db
    .prepare(`
      SELECT id, local_project_id, name, description, script_parse_mode, style_id, aspect_ratio, status,
             summary_json, local_created_at, local_updated_at, last_synced_at, created_at, updated_at
      FROM user_projects
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(userId, pageSize, offset) as Array<Record<string, unknown> & { summary_json?: string }>

  return {
    success: true,
    data: {
      projects: projects.map(project => ({
        ...project,
        summary: parseJsonText(project.summary_json, {})
      })),
      pagination: {
        page,
        pageSize,
        total: total.count
      }
    }
  }
})
