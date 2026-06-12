import { getDb, parseJsonText } from '../../../../utils/db'
import { requireAdmin } from '../../../../utils/auth'
import { requiredParam } from '../../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const projects = getDb()
    .prepare(`
      SELECT id, local_project_id, name, description, script_parse_mode, style_id, aspect_ratio, status,
             summary_json, local_created_at, local_updated_at, last_synced_at, created_at, updated_at
      FROM user_projects
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `)
    .all(userId) as Array<Record<string, unknown> & { summary_json?: string }>

  return {
    success: true,
    data: {
      projects: projects.map(project => ({
        ...project,
        summary: parseJsonText(project.summary_json, {})
      }))
    }
  }
})
