import { randomUUID } from 'node:crypto'
import { getAppSettings, getDb, jsonText, nowIso } from '../../utils/db'
import { readJsonBody, requireAuth } from '../../utils/auth'
import { optionalJson, optionalString } from '../../utils/http'
import { chargeModelCall, isBillableModelCallStatus } from '../../utils/credits'

interface LogPayload {
  eventId?: string
  event_id?: string
  requestId?: string
  request_id?: string
  provider?: string
  modelId?: string
  model_id?: string
  operation?: string
  projectId?: string
  project_id?: string
  sceneId?: string
  scene_id?: string
  status?: string
  durationMs?: number
  duration_ms?: number
  estimatedCost?: number
  estimated_cost?: number
  errorMessage?: string
  error_message?: string
  request?: unknown
  response?: unknown
  error?: unknown
  createdAt?: string
  created_at?: string
}

function normalizeLogs(body: Record<string, unknown>) {
  if (Array.isArray(body.logs)) return body.logs as LogPayload[]
  return [body as LogPayload]
}

function archiveLogsIfNeeded() {
  const db = getDb()
  const maxRows = getAppSettings().logArchiveMaxRows
  const count = db.prepare('SELECT COUNT(*) AS count FROM model_call_logs WHERE archived_at IS NULL').get() as { count: number }
  if (count.count <= maxRows) return

  const overflow = Math.max(1, count.count - maxRows)
  const rows = db.prepare(`
    SELECT * FROM model_call_logs
    WHERE archived_at IS NULL
    ORDER BY created_at ASC
    LIMIT ?
  `).all(overflow)
  const timestamp = nowIso()
  db.transaction(() => {
    db.prepare(`
      INSERT INTO log_archives (id, archive_type, row_count, payload_json, created_at)
      VALUES (?, 'model_call_logs', ?, ?, ?)
    `).run(randomUUID(), rows.length, jsonText(rows), timestamp)
    const mark = db.prepare('UPDATE model_call_logs SET archived_at = ? WHERE id = ?')
    for (const row of rows as Array<{ id: string }>) {
      mark.run(timestamp, row.id)
    }
  })()
}

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readJsonBody<Record<string, unknown>>(event)
  const logs = normalizeLogs(body)
  const db = getDb()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO model_call_logs
      (id, user_id, client_event_id, request_id, provider, model_id, operation, project_id, scene_id, status,
       duration_ms, estimated_cost, error_message, request_json, response_json, error_json, created_at, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `)

  let inserted = 0
  db.transaction((items: LogPayload[]) => {
    for (const log of items) {
      const logId = randomUUID()
      const eventId = optionalString(log.eventId || log.event_id, 128) || null
      const result = insert.run(
        logId,
        auth.user.id,
        eventId,
        optionalString(log.requestId || log.request_id, 128),
        optionalString(log.provider, 128),
        optionalString(log.modelId || log.model_id, 256),
        optionalString(log.operation, 128),
        optionalString(log.projectId || log.project_id, 128),
        optionalString(log.sceneId || log.scene_id, 128),
        optionalString(log.status, 64) || 'unknown',
        Number(log.durationMs ?? log.duration_ms ?? 0) || 0,
        Number(log.estimatedCost ?? log.estimated_cost ?? 0) || 0,
        optionalString(log.errorMessage || log.error_message, 4096),
        jsonText(optionalJson(log.request) || {}),
        jsonText(optionalJson(log.response) || {}),
        jsonText(optionalJson(log.error) || {}),
        optionalString(log.createdAt || log.created_at, 64) || nowIso()
      )
      if (result.changes === 0) continue
      inserted += 1
      if (isBillableModelCallStatus(optionalString(log.status, 64))) {
        chargeModelCall({
          userId: auth.user.id,
          logId,
          operation: optionalString(log.operation, 128),
          provider: optionalString(log.provider, 128),
          modelId: optionalString(log.modelId || log.model_id, 256)
        })
      }
    }
  })(logs)

  archiveLogsIfNeeded()

  return {
    success: true,
    data: {
      inserted,
      duplicates: logs.length - inserted
    }
  }
})
