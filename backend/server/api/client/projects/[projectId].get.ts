import { createError } from 'h3'
import { getDb, parseJsonText } from '../../../utils/db'
import { requireAuth } from '../../../utils/auth'
import { requiredParam } from '../../../utils/http'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const projectId = requiredParam(event, 'projectId')
  const db = getDb()
  const ownerFilter = auth.user.role === 'admin' ? '' : 'AND p.user_id = ?'
  const params = auth.user.role === 'admin' ? [projectId] : [projectId, auth.user.id]
  const project = db.prepare(`
    SELECT p.id, p.user_id, u.account AS owner_account, u.display_name AS owner_display_name,
           p.local_project_id, p.name, p.description, p.script_parse_mode, p.style_id,
           p.aspect_ratio, p.status, p.local_created_at, p.local_updated_at,
           p.last_synced_at, p.updated_at, s.snapshot_json, s.created_at AS snapshot_created_at
    FROM user_projects p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN user_project_snapshots s ON s.id = (
      SELECT latest.id FROM user_project_snapshots latest
      WHERE latest.project_id = p.id
      ORDER BY latest.created_at DESC LIMIT 1
    )
    WHERE p.id = ? ${ownerFilter}
    LIMIT 1
  `).get(...params) as Record<string, unknown> | undefined

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  return {
    success: true,
    data: {
      project: {
        id: project.id,
        ownerUserId: project.user_id,
        ownerAccount: project.owner_account,
        ownerDisplayName: project.owner_display_name,
        localProjectId: project.local_project_id,
        name: project.name,
        description: project.description || '',
        scriptParseMode: project.script_parse_mode || '',
        styleId: project.style_id || '',
        aspectRatio: project.aspect_ratio || '',
        status: project.status || '',
        localCreatedAt: project.local_created_at,
        localUpdatedAt: project.local_updated_at,
        lastSyncedAt: project.last_synced_at,
        updatedAt: project.updated_at,
        snapshotCreatedAt: project.snapshot_created_at,
        snapshot: parseJsonText(project.snapshot_json as string | null, null)
      }
    }
  }
})
