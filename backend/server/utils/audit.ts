import { getRequestHeader, getRequestIP } from 'h3'
import { randomUUID } from 'node:crypto'
import { getDb, jsonText, nowIso } from './db'

export function writeAudit(event: unknown, input: {
  actorUserId?: string | null
  action: string
  targetType?: string
  targetId?: string
  metadata?: unknown
}) {
  const requestEvent = event as Parameters<typeof getRequestHeader>[0]
  getDb()
    .prepare(`
      INSERT INTO audit_logs
        (id, actor_user_id, action, target_type, target_id, metadata_json, ip, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      input.actorUserId || null,
      input.action,
      input.targetType || null,
      input.targetId || null,
      input.metadata === undefined ? null : jsonText(input.metadata),
      getRequestIP(requestEvent, { xForwardedFor: true }) || '',
      getRequestHeader(requestEvent, 'user-agent') || '',
      nowIso()
    )
}
