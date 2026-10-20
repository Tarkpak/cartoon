import type { Database } from 'bun:sqlite'
import { createError } from 'h3'
import { collaborationId, collaborationResourceType, type CollaborationWindowPresence, type CollaborationResource } from '../../../shared/types/project-collaboration'

export const COLLABORATION_PRESENCE_TTL_MS = 35_000

/** Presence describes activity; only a resource lease grants exclusive write access. */
export function updateCollaborationWindowPresence(db: Database, input: {
  projectId: string, ownerId: string, userId: string, deviceId: unknown, sessionId: unknown,
  editable: boolean, editing?: unknown, leaving?: boolean, nowMs?: number, resources: CollaborationResource[]
}): { collaborators: CollaborationWindowPresence[] } {
  let deviceId: string, sessionId: string
  try { deviceId = collaborationId(input.deviceId); sessionId = collaborationId(input.sessionId) }
  catch { throw createError({ statusCode: 400, message: '协作窗口标识无效' }) }
  const now = input.nowMs ?? Date.now()
  const scopes = input.editing ?? []
  if (!Array.isArray(scopes) || scopes.length > 100) throw createError({ statusCode: 400, message: '编辑状态无效' })
  const editing = scopes.map(scope => {
    try {
      const type = collaborationResourceType(scope?.type), id = collaborationId(scope?.id)
      return { type, id }
    } catch { throw createError({ statusCode: 400, message: '编辑对象无效' }) }
  }).filter(scope => input.editable && input.resources.some(item => item.type === scope.type && item.id === scope.id && !item.deleted))
  db.query('DELETE FROM project_collaboration_window_presence WHERE project_id = ? AND last_seen_at <= ?').run(input.projectId, now - COLLABORATION_PRESENCE_TTL_MS)
  if (input.leaving) {
    db.query('DELETE FROM project_collaboration_window_presence WHERE project_id = ? AND user_id = ? AND device_id = ? AND session_id = ?').run(input.projectId, input.userId, deviceId, sessionId)
    db.query('DELETE FROM project_collaboration_presence WHERE project_id = ? AND user_id = ? AND device_id = ? AND session_id = ?').run(input.projectId, input.userId, deviceId, sessionId)
  } else {
    db.query(`INSERT INTO project_collaboration_window_presence (project_id, user_id, device_id, session_id, editing_json, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, user_id, device_id, session_id) DO UPDATE SET editing_json = excluded.editing_json, last_seen_at = excluded.last_seen_at`)
      .run(input.projectId, input.userId, deviceId, sessionId, JSON.stringify(editing), now)
  }
  const rows = db.query(`SELECT p.user_id, p.device_id, p.session_id, p.editing_json, u.display_name, u.account
    FROM project_collaboration_window_presence p JOIN users u ON u.id = p.user_id
    WHERE p.project_id = ? AND p.last_seen_at > ? AND u.status = 'active'
      AND (p.user_id = ? OR u.role = 'admin' OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.project_id AND m.user_id = p.user_id))
    ORDER BY u.display_name, p.user_id, p.session_id`)
    .all(input.projectId, now - COLLABORATION_PRESENCE_TTL_MS, input.ownerId) as Array<{ user_id: string, device_id: string, session_id: string, editing_json: string, display_name: string, account: string }>
  const leases = db.query('SELECT user_id, device_id, session_id, resource_type, resource_id FROM project_collaboration_leases WHERE project_id = ? AND expires_at > ?')
    .all(input.projectId, now) as Array<{ user_id: string, device_id: string, session_id: string, resource_type: string, resource_id: string }>
  return { collaborators: rows.map(row => ({
    userId: row.user_id, displayName: row.display_name || row.account,
    self: row.user_id === input.userId && row.device_id === deviceId && row.session_id === sessionId,
    editing: JSON.parse(row.editing_json),
    locked: leases.filter(lease => lease.user_id === row.user_id && lease.device_id === row.device_id && lease.session_id === row.session_id)
      .map(lease => ({ type: collaborationResourceType(lease.resource_type), id: lease.resource_id }))
  })) }
}
