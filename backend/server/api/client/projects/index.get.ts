import { getDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/auth'
import { projectOwnerScope } from '../../../utils/admin-resource-scope'
import { pagination } from '../../../utils/http'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)
  const scope = projectOwnerScope(auth.user.role, auth.user.id)
  const total = db.prepare(`SELECT COUNT(*) AS count FROM user_projects p ${scope.where}`)
    .get(...scope.params) as { count: number }
  const projects = db.prepare(`
    SELECT p.id, p.user_id, u.account AS owner_account, u.display_name AS owner_display_name,
           p.local_project_id, p.name, p.description, p.script_parse_mode, p.style_id,
           p.aspect_ratio, p.status, p.local_created_at, p.local_updated_at,
           p.last_synced_at, p.updated_at
    FROM user_projects p
    JOIN users u ON u.id = p.user_id
    ${scope.where}
    ORDER BY p.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...scope.params, pageSize, offset) as Array<Record<string, unknown>>

  return {
    success: true,
    data: {
      projects: projects.map(project => ({
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
        updatedAt: project.updated_at
      })),
      pagination: {
        page,
        pageSize,
        total: total.count,
        totalPages: Math.max(1, Math.ceil(total.count / pageSize))
      }
    }
  }
})
