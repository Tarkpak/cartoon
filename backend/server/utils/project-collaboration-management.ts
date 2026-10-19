import type { Database } from 'bun:sqlite'
import { createError } from 'h3'
import type { AuthContext } from './auth'
import { nextCollaborationTimestamp, projectUsesCollaboration } from './project-collaboration'
import {
  canonicalCloudProjectMembers, normalizeProjectMemberRole, normalizeProjectPermissions,
  permissionsForProjectRole, projectPermissionKeys
} from './project-permissions'
import { collaborationId } from '../../../shared/types/project-collaboration'

function memberAccess(db: Database, auth: AuthContext, projectId: string, ownerId: string) {
  const isOwner = auth.user.id === ownerId
  if (isOwner || auth.user.role === 'admin') return { role: isOwner ? 'owner' : 'admin', isOwner, permissions: [...projectPermissionKeys] }
  const member = canonicalCloudProjectMembers(db, projectId).find(member => member.userId === auth.user.id)
  if (!member) throw createError({ statusCode: 404, message: '项目不存在' })
  return { role: member.role, isOwner: false, permissions: member.permissions }
}

function membersResult(db: Database, auth: AuthContext, projectId: string, ownerId: string) {
  const owner = db.query('SELECT id, account, display_name FROM users WHERE id = ?').get(ownerId) as { id: string, account: string, display_name: string } | null
  if (!owner) throw createError({ statusCode: 404, message: '项目所有者不存在' })
  return {
    collaboration: true,
    owner: { userId: owner.id, account: owner.account, displayName: owner.display_name, role: 'owner', permissions: [...projectPermissionKeys] },
    members: canonicalCloudProjectMembers(db, projectId),
    access: memberAccess(db, auth, projectId, ownerId), currentUserId: auth.user.id
  }
}

/** Caller holds an immediate transaction and has checked the action-specific permission. */
export function manageCollaboration(db: Database, auth: AuthContext, project: { id: string, ownerId: string, deletedAt: string | null }, body: Record<string, unknown>) {
  if (!projectUsesCollaboration(db, project.id)) throw createError({ statusCode: 409, message: '项目尚未启用按集协作' })
  const projectVersion = (db.query('SELECT updated_at FROM user_projects WHERE id = ?').get(project.id) as { updated_at: string }).updated_at
  if (body.action === 'delete') {
    if (project.deletedAt) return { deleted: true, deletedAt: project.deletedAt }
    const timestamp = nextCollaborationTimestamp(Date.now(), projectVersion)
    db.query('UPDATE user_projects SET deleted_at = ?, updated_at = ?, local_updated_at = ?, last_synced_at = ? WHERE id = ?')
      .run(timestamp, timestamp, timestamp, timestamp, project.id)
    db.query('DELETE FROM project_collaboration_leases WHERE project_id = ?').run(project.id)
    // Keep resources, original snapshot and operation receipts available for audit/recovery.
    return { deleted: true, deletedAt: timestamp }
  }
  if (body.action === 'members') return membersResult(db, auth, project.id, project.ownerId)
  let userId: string
  try { userId = collaborationId(body.userId) }
  catch { throw createError({ statusCode: 400, message: '成员标识无效' }) }
  if (userId === project.ownerId) throw createError({ statusCode: 400, message: '不能修改项目所有者的成员角色' })
  const previous = db.query('SELECT role, permissions_json, updated_at FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(project.id, userId) as { role: string, permissions_json: string, updated_at: string } | null
  const access = memberAccess(db, auth, project.id, project.ownerId)
  const timestamp = nextCollaborationTimestamp(Date.now(), previous?.updated_at, projectVersion)
  if (body.action === 'memberRemove') {
    if (userId === auth.user.id) throw createError({ statusCode: 400, message: '不能移除当前账号自己' })
    if (!previous) return membersResult(db, auth, project.id, project.ownerId)
    if (body.expectedUpdatedAt !== previous.updated_at) throw createError({ statusCode: 409, message: '成员权限已变化，请刷新后重试' })
    db.query('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(project.id, userId)
    db.query('DELETE FROM project_collaboration_leases WHERE project_id = ? AND user_id = ?').run(project.id, userId)
  } else {
    const target = db.query('SELECT status FROM users WHERE id = ?').get(userId) as { status: string } | null
    if (!target || target.status !== 'active') throw createError({ statusCode: 400, message: '成员账号不存在或已停用' })
    const role = normalizeProjectMemberRole(body.role)
    const permissions = permissionsForProjectRole(role, normalizeProjectPermissions(body.permissions))
    if (permissions.some(permission => !access.permissions.includes(permission))) throw createError({ statusCode: 403, message: '不能授予超出自身范围的权限' })
    const permissionsJson = JSON.stringify(permissions)
    const unchanged = previous?.role === role && JSON.stringify(canonicalCloudProjectMembers(db, project.id).find(member => member.userId === userId)?.permissions) === permissionsJson
    if (unchanged) return membersResult(db, auth, project.id, project.ownerId)
    if ((previous?.updated_at ?? null) !== body.expectedUpdatedAt) throw createError({ statusCode: 409, message: '成员权限已变化，请刷新后重试' })
    db.query(`INSERT INTO project_members (project_id, user_id, role, permissions_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role, permissions_json = excluded.permissions_json, updated_at = excluded.updated_at`)
      .run(project.id, userId, role, permissionsJson, timestamp, timestamp)
    // Downgrades fence existing editor tokens immediately, even if that user remains a viewer.
    db.query('DELETE FROM project_collaboration_leases WHERE project_id = ? AND user_id = ?').run(project.id, userId)
  }
  db.query('UPDATE user_projects SET updated_at = ?, local_updated_at = ?, last_synced_at = ? WHERE id = ?')
    .run(timestamp, timestamp, timestamp, project.id)
  return membersResult(db, auth, project.id, project.ownerId)
}
