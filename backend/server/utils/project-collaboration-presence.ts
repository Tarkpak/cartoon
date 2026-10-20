import type { Database } from 'bun:sqlite'
import { collaborationId, collaborationResourceType, type CollaborationPresence } from '../../../shared/types/project-collaboration'

/** Presence describes activity; it never acquires editing leases. Caller checks project access. */
export function updateCollaborationPresence(db: Database, projectId: string, userId: string, deviceId: string, sessionId: string, input: unknown, editable: boolean, now = Date.now()): CollaborationPresence[] {
  const scopes: CollaborationPresence['scopes'] = []
  if (editable && Array.isArray(input)) for (const raw of input.slice(0, 100)) {
    try {
      const type = collaborationResourceType(raw?.type), id = collaborationId(raw?.id)
      const exists = db.query('SELECT 1 FROM project_collaboration_resources WHERE project_id = ? AND resource_type = ? AND resource_id = ? AND deleted = 0').get(projectId, type, id)
      if (exists && !scopes.some(item => item.type === type && item.id === id)) scopes.push({ type, id })
    } catch { /* Ignore invalid activity metadata; it must not block content synchronization. */ }
  }
  db.query('DELETE FROM project_collaboration_presence WHERE project_id = ? AND expires_at <= ?').run(projectId, now)
  db.query(`INSERT INTO project_collaboration_presence (project_id, user_id, device_id, session_id, scopes_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, user_id, device_id, session_id)
    DO UPDATE SET scopes_json = excluded.scopes_json, expires_at = excluded.expires_at`)
    .run(projectId, userId, deviceId, sessionId, JSON.stringify(scopes), now + 45_000)
  const rows = db.query(`SELECT p.user_id, p.device_id, p.session_id, p.scopes_json, u.display_name, u.account
    FROM project_collaboration_presence p JOIN users u ON u.id = p.user_id
    JOIN user_projects project ON project.id = p.project_id
    WHERE p.project_id = ? AND u.status = 'active' AND
      (u.id = project.user_id OR u.role = 'admin' OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.project_id AND m.user_id = u.id))
    ORDER BY u.display_name, p.user_id, p.session_id`).all(projectId) as Array<{ user_id: string, device_id: string, session_id: string, scopes_json: string, display_name: string, account: string }>
  return rows.map(row => ({ userId: row.user_id, displayName: row.display_name || row.account, isCurrentWindow: row.user_id === userId && row.device_id === deviceId && row.session_id === sessionId, scopes: JSON.parse(row.scopes_json) }))
}
