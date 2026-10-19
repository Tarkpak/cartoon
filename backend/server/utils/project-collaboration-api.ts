import { createError } from 'h3'
import type { Database } from 'bun:sqlite'
import type { AuthContext } from './auth'
import { manageCollaboration } from './project-collaboration-management'
import { requireCloudProjectPermission, projectMemberCan, type ProjectPermission } from './project-permissions'
import {
  collaborationChanges,
  enableProjectCollaboration,
  previewProjectCollaboration,
  operateCollaborationLease,
  readCollaboration,
  writeCollaboration
} from './project-collaboration'
import { collaborationId, collaborationResourceType, type CollaborationMutation } from '../../../shared/types/project-collaboration'

export function handleProjectCollaboration(db: Database, auth: AuthContext, body: Record<string, unknown>) {
  let ownerUserId: string
  let localProjectId: string
  try {
    ownerUserId = collaborationId(body.ownerUserId)
    localProjectId = collaborationId(body.localProjectId)
  } catch { throw createError({ statusCode: 400, message: '项目标识无效' }) }
  if (typeof body.action !== 'string' || !['read', 'changes', 'enable', 'lease', 'write', 'members', 'memberPut', 'memberRemove', 'delete', 'generationCheck', 'migrationPreview'].includes(body.action)) throw createError({ statusCode: 400, message: '协作操作无效' })
  // All checks and writes share one SQLite transaction, including membership checks.
  const transaction = db.transaction(() => {
    const project = db.query('SELECT id, deleted_at FROM user_projects WHERE user_id = ? AND local_project_id = ?')
      .get(ownerUserId, localProjectId) as { id: string, deleted_at: string | null } | null
    if (!project) throw createError({ statusCode: 404, message: '项目不存在' })
    const permission: ProjectPermission = ['read', 'changes', 'members'].includes(body.action as string) ? 'view'
      : ['memberPut', 'memberRemove'].includes(body.action as string) ? 'manage_members' : body.action === 'delete' ? 'delete' : body.action === 'generationCheck' ? 'generate' : 'edit'
    const access = requireCloudProjectPermission({ db, auth, projectId: project.id, permission })
    const editable = auth.user.role === 'admin' || auth.user.id === ownerUserId || (!!access.role && projectMemberCan({ role: access.role, permissions_json: access.permissions_json }, 'edit'))
    if (project.deleted_at && body.action !== 'delete') throw createError({ statusCode: 410, message: '项目已删除' })
    if (body.action === 'read') return { ...readCollaboration(db, project.id), editable }
    if (body.action === 'changes') return { ...collaborationChanges(db, project.id, body.after as number), editable }
    if (['members', 'memberPut', 'memberRemove', 'delete'].includes(body.action as string)) return manageCollaboration(db, auth, { id: project.id, ownerId: ownerUserId, deletedAt: project.deleted_at }, body)
    const canTakeover = auth.user.id === ownerUserId || auth.user.role === 'admin'
    if (body.action === 'migrationPreview') {
      if (!canTakeover) throw createError({ statusCode: 403, message: '仅项目所有者或管理员可以迁移项目' })
      return previewProjectCollaboration(db, project.id, typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : undefined)
    }
    if (body.action === 'enable') {
      if (!canTakeover) throw createError({ statusCode: 403, message: '仅项目所有者或管理员可以迁移项目' })
      if (typeof body.expectedUpdatedAt !== 'string' || typeof body.leaseToken !== 'string' || typeof body.snapshotHash !== 'string') throw createError({ statusCode: 400, message: '迁移需要已核对的版本和编辑权' })
      return enableProjectCollaboration(db, { projectId: project.id, userId: auth.user.id, expectedUpdatedAt: body.expectedUpdatedAt, leaseToken: body.leaseToken, snapshotHash: body.snapshotHash })
    }
    let deviceId: string
    let sessionId: string
    try { deviceId = collaborationId(body.deviceId); sessionId = collaborationId(body.sessionId) }
    catch { throw createError({ statusCode: 400, message: '设备或窗口标识无效' }) }
    if (body.action === 'generationCheck') {
      requireCloudProjectPermission({ db, auth, projectId: project.id, permission: 'edit' })
      const snapshot = readCollaboration(db, project.id)
      if (!['episode', 'character', 'settings'].includes(String(body.type)) || typeof body.id !== 'string' || !Number.isSafeInteger(body.expectedRevision) || !Number.isSafeInteger(body.settingsRevision)) throw createError({ statusCode: 400, message: '生成输入版本无效' })
      const resource = snapshot.resources.find(item => item.type === body.type && item.id === body.id && !item.deleted)
      const settings = snapshot.resources.find(item => item.type === 'settings' && !item.deleted)
      if (!resource || resource.revision !== body.expectedRevision || settings?.revision !== body.settingsRevision) throw createError({ statusCode: 409, message: '生成输入已变化，请刷新后重新生成或手动处理已有结果' })
      const lease = operateCollaborationLease(db, { projectId: project.id, userId: auth.user.id, deviceId, sessionId, type: resource.type, id: body.id, token: typeof body.token === 'string' ? body.token : undefined, action: 'check', canTakeover: false })
      if (!lease.editable) throw createError({ statusCode: 423, message: '请先取得当前资源的编辑权' })
      return { resource, ...(resource.type === 'episode' ? { episode: resource } : {}), settings }
    }
    if (body.action === 'lease') {
      let type
      let id
      try { type = collaborationResourceType(body.type); id = collaborationId(body.id) }
      catch { throw createError({ statusCode: 400, message: '编辑对象无效' }) }
      return operateCollaborationLease(db, {
        projectId: project.id, userId: auth.user.id, deviceId, sessionId, type, id,
        token: typeof body.token === 'string' ? body.token : undefined,
        action: body.leaseAction as 'acquire' | 'heartbeat' | 'check' | 'release' | 'takeover', canTakeover
      })
    }
    return writeCollaboration(db, {
      projectId: project.id, userId: auth.user.id, deviceId, sessionId,
      operationId: body.operationId as string, mutations: body.mutations as CollaborationMutation[]
    })
  })
  try {
    return ['read', 'changes', 'members'].includes(body.action as string) ? transaction() : transaction.immediate()
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'SQLITE_BUSY') {
      throw createError({ statusCode: 503, message: '协作服务繁忙，请稍后使用相同操作 ID 重试' })
    }
    throw cause
  }
}
