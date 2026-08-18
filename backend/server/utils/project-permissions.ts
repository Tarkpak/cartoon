import { createError } from 'h3'
import type { Database } from 'bun:sqlite'
import type { AuthContext } from './auth'

export const projectPermissionKeys = [
  'view',
  'edit',
  'generate',
  'export',
  'delete',
  'manage_members'
] as const

export type ProjectPermission = typeof projectPermissionKeys[number]
export type ProjectMemberRole = 'manager' | 'editor' | 'viewer' | 'custom'

const rolePermissions: Record<Exclude<ProjectMemberRole, 'custom'>, ProjectPermission[]> = {
  manager: ['view', 'edit', 'generate', 'export', 'manage_members'],
  editor: ['view', 'edit', 'generate', 'export'],
  viewer: ['view']
}

export function normalizeProjectMemberRole(value: unknown): ProjectMemberRole {
  if (value === 'manager' || value === 'editor' || value === 'viewer' || value === 'custom') {
    return value
  }
  throw createError({ statusCode: 400, statusMessage: 'Invalid project member role' })
}

export function normalizeProjectPermissions(value: unknown): ProjectPermission[] {
  if (!Array.isArray(value)) return []
  const requested = new Set(value.filter(item => typeof item === 'string'))
  return projectPermissionKeys.filter(permission => requested.has(permission))
}

export function permissionsForProjectRole(
  role: ProjectMemberRole,
  customPermissions: ProjectPermission[] = []
): ProjectPermission[] {
  if (role !== 'custom') return [...rolePermissions[role]]
  const requested = new Set(normalizeProjectPermissions(customPermissions))
  requested.add('view')
  if (requested.has('generate')) requested.add('edit')
  return projectPermissionKeys.filter(permission => requested.has(permission))
}

export function projectMemberCan(row: {
  role: string
  permissions_json: string | null
}, permission: ProjectPermission): boolean {
  const role = normalizeProjectMemberRole(row.role)
  const custom = (() => {
    try {
      return normalizeProjectPermissions(JSON.parse(row.permissions_json || '[]'))
    } catch {
      return []
    }
  })()
  return permissionsForProjectRole(role, custom).includes(permission)
}

export function canonicalCloudProjectMembers(db: Database, projectId: string) {
  const rows = db.prepare(`
    SELECT pm.user_id, u.account, u.display_name, pm.role, pm.permissions_json,
           pm.created_at, pm.updated_at
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ?
    ORDER BY u.display_name, u.account
  `).all(projectId) as Array<{
    user_id: string
    account: string
    display_name: string
    role: string
    permissions_json: string | null
    created_at: string
    updated_at: string
  }>

  return rows.map((row) => {
    const role = normalizeProjectMemberRole(row.role)
    let customPermissions: ProjectPermission[] = []
    try {
      customPermissions = normalizeProjectPermissions(JSON.parse(row.permissions_json || '[]'))
    } catch {
      customPermissions = []
    }
    return {
      userId: row.user_id,
      account: row.account,
      displayName: row.display_name,
      role,
      permissions: permissionsForProjectRole(role, customPermissions),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  })
}

export function canonicalizeCloudProjectSnapshot(
  snapshot: unknown,
  members: ReturnType<typeof canonicalCloudProjectMembers>
): Record<string, unknown> {
  const source = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : {}
  const sanitized = { ...source }
  delete sanitized.access
  delete sanitized.members
  return { ...sanitized, members }
}

export function requireCloudProjectPermission(input: {
  db: Database
  auth: AuthContext
  projectId: string
  permission: ProjectPermission
}) {
  const project = input.db.prepare(`
    SELECT p.id, p.user_id, pm.role, pm.permissions_json
    FROM user_projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
    WHERE p.id = ?
    LIMIT 1
  `).get(input.auth.user.id, input.projectId) as {
    id: string
    user_id: string
    role: string | null
    permissions_json: string | null
  } | undefined

  if (!project) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  if (input.auth.user.role === 'admin' || project.user_id === input.auth.user.id) return project
  if (!project.role || !projectMemberCan({
    role: project.role,
    permissions_json: project.permissions_json
  }, input.permission)) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }
  return project
}
