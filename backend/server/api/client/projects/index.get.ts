import { getDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/auth'
import { pagination } from '../../../utils/http'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const db = getDb()
  const { page, pageSize, offset } = pagination(event)
  const scope = auth.user.role === 'admin'
    ? { where: '', params: [] as string[] }
    : {
        where: `WHERE p.user_id = ? OR EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = ?
            AND (pm.role IN ('manager', 'editor', 'viewer') OR instr(pm.permissions_json, '"view"') > 0)
        )`,
        params: [auth.user.id, auth.user.id]
      }
  const total = db.prepare(`SELECT COUNT(*) AS count FROM user_projects p ${scope.where}`)
    .get(...scope.params) as { count: number }
  const projects = db.prepare(`
    SELECT p.id, p.user_id, u.account AS owner_account, u.display_name AS owner_display_name,
           p.local_project_id, p.name, p.description, p.script_parse_mode, p.style_id,
           p.aspect_ratio, p.status, p.local_created_at, p.local_updated_at,
           p.last_synced_at, p.updated_at, pm.role AS member_role, pm.permissions_json
    FROM user_projects p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
    ${scope.where}
    ORDER BY p.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(auth.user.id, ...scope.params, pageSize, offset) as Array<Record<string, unknown>>

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
        updatedAt: project.updated_at,
        accessRole: project.user_id === auth.user.id ? 'owner' : (project.member_role || (auth.user.role === 'admin' ? 'admin' : 'viewer')),
        accessPermissions: project.user_id === auth.user.id || auth.user.role === 'admin'
          ? ['view', 'edit', 'generate', 'export', 'delete', 'manage_members']
          : JSON.parse(String(project.permissions_json || '[]'))
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
