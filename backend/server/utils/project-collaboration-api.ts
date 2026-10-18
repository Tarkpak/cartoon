import { createError } from 'h3'
import type { Database } from 'bun:sqlite'
import type { AuthContext } from './auth'
import { requireCloudProjectPermission } from './project-permissions'
import {
  collaborationChanges,
  enableProjectCollaboration,
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
  if (typeof body.action !== 'string' || !['read', 'changes', 'enable', 'lease', 'write'].includes(body.action)) throw createError({ statusCode: 400, message: '协作操作无效' })
  // All checks and writes share one SQLite transaction, including membership checks.
  const transaction = db.transaction(() => {
    const project = db.query('SELECT id, deleted_at FROM user_projects WHERE user_id = ? AND local_project_id = ?')
      .get(ownerUserId, localProjectId) as { id: string, deleted_at: string | null } | null
    if (!project) throw createError({ statusCode: 404, message: '项目不存在' })
    const permission = body.action === 'read' || body.action === 'changes' ? 'view' : 'edit'
    requireCloudProjectPermission({ db, auth, projectId: project.id, permission })
    if (project.deleted_at) throw createError({ statusCode: 410, message: '项目已删除' })
    if (body.action === 'read') return readCollaboration(db, project.id)
    if (body.action === 'changes') return collaborationChanges(db, project.id, body.after as number)
    const canTakeover = auth.user.id === ownerUserId || auth.user.role === 'admin'
    if (body.action === 'enable') {
      if (!canTakeover) throw createError({ statusCode: 403, message: '仅项目所有者或管理员可以迁移项目' })
      if (typeof body.expectedUpdatedAt !== 'string' || typeof body.leaseToken !== 'string') throw createError({ statusCode: 400, message: '迁移需要已核对的版本和编辑权' })
      return enableProjectCollaboration(db, { projectId: project.id, userId: auth.user.id, expectedUpdatedAt: body.expectedUpdatedAt, leaseToken: body.leaseToken })
    }
    let deviceId: string
    let sessionId: string
    try { deviceId = collaborationId(body.deviceId); sessionId = collaborationId(body.sessionId) }
    catch { throw createError({ statusCode: 400, message: '设备或窗口标识无效' }) }
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
    return body.action === 'read' || body.action === 'changes' ? transaction() : transaction.immediate()
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'SQLITE_BUSY') {
      throw createError({ statusCode: 503, message: '协作服务繁忙，请稍后使用相同操作 ID 重试' })
    }
    throw cause
  }
}
