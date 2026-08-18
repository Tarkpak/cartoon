import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { getDb, jsonText, nowIso } from '../../../utils/db'
import { readJsonBody, requireAuth } from '../../../utils/auth'
import { optionalJson, optionalString } from '../../../utils/http'
import { projectSyncOwnerId } from '../../../utils/admin-resource-scope'
import { storeProjectSnapshot } from '../../../utils/project-snapshots'
import {
  canonicalCloudProjectMembers,
  canonicalizeCloudProjectSnapshot,
  normalizeProjectMemberRole,
  normalizeProjectPermissions,
  permissionsForProjectRole,
  projectMemberCan
} from '../../../utils/project-permissions'

interface ProjectPayload {
  id?: string
  force?: boolean
  localProjectId?: string
  name?: string
  title?: string
  description?: string
  scriptParseMode?: string
  script_parse_mode?: string
  styleId?: string
  style_id?: string
  aspectRatio?: string
  aspect_ratio?: string
  status?: string
  createdAt?: string
  created_at?: string
  localCreatedAt?: string
  local_created_at?: string
  updatedAt?: string
  updated_at?: string
  localUpdatedAt?: string
  local_updated_at?: string
  summary?: unknown
  snapshot?: unknown
  ownerUserId?: string
  members?: Array<{
    userId?: string
    role?: string
    permissions?: unknown
  }>
}

function normalizeProjects(body: Record<string, unknown>) {
  if (Array.isArray(body.projects)) return body.projects as ProjectPayload[]
  if (body.project && typeof body.project === 'object') return [body.project as ProjectPayload]
  return [body as ProjectPayload]
}

function skippedProjectResult(input: {
  localProjectId: string
  projectId: string
  reason?: string
}) {
  return {
    localProjectId: input.localProjectId,
    projectId: input.projectId,
    status: 'skipped' as const,
    reason: input.reason || 'unknown'
  }
}

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readJsonBody<Record<string, unknown>>(event)
  const projects = normalizeProjects(body)
  if (projects.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'projects is required' })
  }

  const db = getDb()
  const resolveProjectAccess = (project: ProjectPayload, localProjectId: string) => {
    const requestedOwnerId = optionalString(project.ownerUserId, 128)
    const defaultOwnerId = projectSyncOwnerId({
      role: auth.user.role,
      authenticatedUserId: auth.user.id,
      requestedOwnerId
    })
    const ownerUserId = requestedOwnerId || defaultOwnerId
    const existing = db.prepare(`
      SELECT p.id, p.user_id, pm.role, pm.permissions_json
      FROM user_projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
      WHERE p.user_id = ? AND p.local_project_id = ?
      LIMIT 1
    `).get(auth.user.id, ownerUserId, localProjectId) as {
      id: string
      user_id: string
      role: string | null
      permissions_json: string | null
    } | undefined
    const isOwnerOrAdmin = auth.user.role === 'admin' || ownerUserId === auth.user.id
    const canEdit = isOwnerOrAdmin || !!existing?.role && projectMemberCan({
      role: existing.role,
      permissions_json: existing.permissions_json
    }, 'edit')
    const canManageMembers = isOwnerOrAdmin || !!existing?.role && projectMemberCan({
      role: existing.role,
      permissions_json: existing.permissions_json
    }, 'manage_members')
    if (existing && !isOwnerOrAdmin) {
      if (!canEdit && !(Array.isArray(project.members) && canManageMembers)) {
        throw createError({ statusCode: 403, statusMessage: 'Project edit permission required' })
      }
    } else if (!existing && !isOwnerOrAdmin) {
      throw createError({ statusCode: 403, statusMessage: 'Project owner is invalid' })
    }
    if (ownerUserId !== auth.user.id) {
      const owner = db.prepare('SELECT id FROM users WHERE id = ? LIMIT 1').get(ownerUserId)
      if (!owner) throw createError({ statusCode: 400, statusMessage: 'project.ownerUserId is invalid' })
    }
    return { ownerUserId, existing, canEdit, canManageMembers }
  }
  const timestamp = nowIso()
  const syncProjectMembers = (
    projectId: string,
    ownerUserId: string,
    members: NonNullable<ProjectPayload['members']>
  ) => {
    const keepUserIds: string[] = []
    const upsertMember = db.prepare(`
      INSERT INTO project_members
        (project_id, user_id, role, permissions_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET
        role = excluded.role,
        permissions_json = excluded.permissions_json,
        updated_at = excluded.updated_at
    `)
    for (const member of members) {
      const userId = optionalString(member.userId, 128)
      if (!userId || userId === ownerUserId) continue
      const userExists = db.prepare(`SELECT 1 FROM users WHERE id = ? AND status = 'active'`).get(userId)
      if (!userExists) continue
      const role = normalizeProjectMemberRole(member.role)
      const permissions = permissionsForProjectRole(role, normalizeProjectPermissions(member.permissions))
      if (role === 'custom' && !permissions.includes('view')) permissions.unshift('view')
      upsertMember.run(projectId, userId, role, jsonText(permissions), timestamp, timestamp)
      keepUserIds.push(userId)
    }
    if (keepUserIds.length === 0) {
      db.prepare('DELETE FROM project_members WHERE project_id = ?').run(projectId)
    } else {
      const placeholders = keepUserIds.map(() => '?').join(', ')
      db.prepare(`DELETE FROM project_members WHERE project_id = ? AND user_id NOT IN (${placeholders})`)
        .run(projectId, ...keepUserIds)
    }
  }
  const upsertProject = db.prepare(`
    INSERT INTO user_projects
      (id, user_id, local_project_id, name, description, script_parse_mode, style_id, aspect_ratio, status,
       summary_json, local_created_at, local_updated_at, last_synced_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, local_project_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      script_parse_mode = excluded.script_parse_mode,
      style_id = excluded.style_id,
      aspect_ratio = excluded.aspect_ratio,
      status = excluded.status,
      summary_json = excluded.summary_json,
      local_created_at = excluded.local_created_at,
      local_updated_at = excluded.local_updated_at,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at
  `)
  const selectProject = db.prepare('SELECT id, local_updated_at FROM user_projects WHERE user_id = ? AND local_project_id = ? LIMIT 1')
  const synced = db.transaction((items: ProjectPayload[]) => {
    const result: Array<{ localProjectId: string, projectId: string, status: 'synced' | 'skipped', reason?: string }> = []
    for (const project of items) {
      const localProjectId = optionalString(project.localProjectId || project.id, 128)
      if (!localProjectId) {
        throw createError({ statusCode: 400, statusMessage: 'project.localProjectId is required' })
      }
      const access = resolveProjectAccess(project, localProjectId)
      const { ownerUserId } = access
      if (!access.canEdit) {
        if (!access.existing || !Array.isArray(project.members) || !access.canManageMembers) {
          throw createError({ statusCode: 403, statusMessage: 'Project edit permission required' })
        }
        syncProjectMembers(access.existing.id, ownerUserId, project.members)
        db.prepare(`
          UPDATE user_projects
          SET last_synced_at = ?, updated_at = ?
          WHERE id = ?
        `).run(timestamp, timestamp, access.existing.id)
        result.push({ localProjectId, projectId: access.existing.id, status: 'synced' })
        continue
      }
      const name = optionalString(project.name || project.title, 256) || '未命名项目'
      const existing = selectProject.get(ownerUserId, localProjectId) as { id: string, local_updated_at: string | null } | undefined
      const projectId = existing?.id || randomUUID()
      const snapshot = optionalJson(project.snapshot) ?? project
      const force = project.force === true
      const localCreatedAt = optionalString(project.localCreatedAt || project.local_created_at || project.createdAt || project.created_at, 64)
      const localUpdatedAt = optionalString(project.localUpdatedAt || project.local_updated_at || project.updatedAt || project.updated_at, 64)
      if (!force && existing?.local_updated_at && localUpdatedAt && localUpdatedAt < existing.local_updated_at) {
        result.push(skippedProjectResult({
          localProjectId,
          projectId,
          reason: 'stale_local_update'
        }))
        continue
      }

      upsertProject.run(
        projectId,
        ownerUserId,
        localProjectId,
        name,
        optionalString(project.description, 2048),
        optionalString(project.scriptParseMode || project.script_parse_mode, 64),
        optionalString(project.styleId || project.style_id, 128),
        optionalString(project.aspectRatio || project.aspect_ratio, 32),
        optionalString(project.status, 64) || 'draft',
        jsonText(project.summary || {}),
        localCreatedAt,
        localUpdatedAt || timestamp,
        timestamp,
        timestamp,
        timestamp
      )

      if (Array.isArray(project.members) && access.canManageMembers) {
        syncProjectMembers(projectId, ownerUserId, project.members)
      }
      const canonicalSnapshot = canonicalizeCloudProjectSnapshot(
        snapshot,
        canonicalCloudProjectMembers(db, projectId)
      )
      storeProjectSnapshot(db, {
        id: randomUUID(),
        userId: ownerUserId,
        projectId,
        snapshotJson: jsonText(canonicalSnapshot),
        createdAt: timestamp
      })
      result.push({ localProjectId, projectId, status: 'synced' })
    }
    return result
  })(projects)

  return {
    success: true,
    data: {
      synced
    }
  }
})
