import { createError } from 'h3'
import { getDb, parseJsonText } from '../../../../../utils/db'
import { requireAdmin } from '../../../../../utils/auth'
import { requiredParam } from '../../../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const userId = requiredParam(event, 'id')
  const projectId = requiredParam(event, 'projectId')
  const db = getDb()
  const project = db
    .prepare(`
      SELECT id, local_project_id, name, description, script_parse_mode, style_id, aspect_ratio, status,
             summary_json, local_created_at, local_updated_at, last_synced_at, created_at, updated_at
      FROM user_projects
      WHERE user_id = ? AND id = ?
      LIMIT 1
    `)
    .get(userId, projectId) as (Record<string, unknown> & { summary_json?: string }) | undefined
  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }
  const snapshot = db
    .prepare(`
      SELECT id, snapshot_json, snapshot_version, created_at
      FROM user_project_snapshots
      WHERE user_id = ? AND project_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(userId, projectId) as { id: string, snapshot_json: string, snapshot_version: number, created_at: string } | undefined

  return {
    success: true,
    data: {
      project: {
        ...project,
        summary: parseJsonText(project.summary_json, {})
      },
      snapshot: snapshot
        ? {
            id: snapshot.id,
            version: snapshot.snapshot_version,
            createdAt: snapshot.created_at,
            data: parseJsonText(snapshot.snapshot_json, {})
          }
        : null
    }
  }
})
