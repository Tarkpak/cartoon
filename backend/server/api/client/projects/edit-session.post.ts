import { createError } from 'h3'
import { getDb } from '../../../utils/db'
import { requireAuth, readJsonBody } from '../../../utils/auth'
import { optionalString } from '../../../utils/http'
import { requireCloudProjectPermission } from '../../../utils/project-permissions'
import { operateProjectEditLease } from '../../../utils/project-edit-leases'
import { projectUsesCollaboration } from '../../../utils/project-collaboration'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const body = await readJsonBody<Record<string, unknown>>(event)
  const ownerUserId = optionalString(body.ownerUserId, 128) || auth.user.id
  const localProjectId = optionalString(body.localProjectId, 128)
  const deviceId = optionalString(body.deviceId, 128)
  const sessionId = optionalString(body.sessionId, 128)
  const action = optionalString(body.action, 32)
  if (!localProjectId || !deviceId || !sessionId || !['acquire', 'heartbeat', 'release', 'check', 'takeover'].includes(action || '')) {
    throw createError({ statusCode: 400, statusMessage: '编辑会话参数无效' })
  }
  const db = getDb()
  return db.transaction(() => {
    const project = db.query('SELECT id, deleted_at FROM user_projects WHERE user_id = ? AND local_project_id = ?')
      .get(ownerUserId, localProjectId) as { id: string, deleted_at: string | null } | null
    if (project?.deleted_at) throw createError({ statusCode: 410, statusMessage: '云端项目已删除' })
    if (project) {
      try { requireCloudProjectPermission({ db, auth, projectId: project.id, permission: 'edit' }) }
      catch {
        try { requireCloudProjectPermission({ db, auth, projectId: project.id, permission: 'manage_members' }) }
        catch { requireCloudProjectPermission({ db, auth, projectId: project.id, permission: 'delete' }) }
      }
    } else if (ownerUserId !== auth.user.id && auth.user.role !== 'admin') throw createError({ statusCode: 404, statusMessage: '项目不存在' })
    const canTakeover = ownerUserId === auth.user.id || auth.user.role === 'admin'
    if (project && projectUsesCollaboration(db, project.id)) {
      return { success: true, data: { editable: false, canTakeover: false, reason: '项目已启用按集协作，请使用协作入口', collaboration: true } }
    }
    const result = operateProjectEditLease(db, {
      ownerUserId, localProjectId, userId: auth.user.id, deviceId, sessionId,
      action: action as 'acquire' | 'heartbeat' | 'release' | 'check' | 'takeover',
      token: optionalString(body.token, 128) || undefined, canTakeover
    })
    const holder = result.lease ? db.query('SELECT account, display_name FROM users WHERE id = ?').get(result.lease.user_id) as { account: string, display_name: string } | null : null
    return { success: true, data: {
      editable: result.editable, canTakeover,
      holderName: holder?.display_name || holder?.account || '',
      expiresAt: result.lease?.expires_at || null,
      token: result.editable ? result.lease?.token : undefined
    } }
  }).immediate()
})
