import { randomUUID } from 'node:crypto'
import { getAppSettings, getDb, jsonText, nowIso } from '../../utils/db'
import { readJsonBody, requireAuth } from '../../utils/auth'
import { optionalJson, optionalString } from '../../utils/http'
import { chargeModelCall, isBillableModelCallStatus } from '../../utils/credits'
import { mergeModelLogMediaRefs, mergeModelLogResponse } from '../../utils/model-call-log-merge'
import { archiveModelLogsIfNeeded } from '../../utils/model-log-archive'

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
  mediaRefs?: unknown
  media_refs?: unknown
  error?: unknown
  createdAt?: string
  created_at?: string
}

function normalizeLogs(body: Record<string, unknown>) {
  if (Array.isArray(body.logs)) return body.logs as LogPayload[]
  return [body as LogPayload]
}

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readJsonBody<Record<string, unknown>>(event)
  const logs = normalizeLogs(body)
  const db = getDb()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO model_call_logs
      (id, user_id, client_event_id, request_id, provider, model_id, operation, project_id, scene_id, status,
       duration_ms, estimated_cost, error_message, request_json, response_json, media_refs_json, error_json, created_at, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `)
  const findExisting = db.prepare(`
    SELECT id, response_json, media_refs_json
    FROM model_call_logs
    WHERE user_id = ? AND client_event_id = ?
    LIMIT 1
  `)
  const updateExisting = db.prepare(`
    UPDATE model_call_logs
    SET request_id = ?, provider = ?, model_id = ?, operation = ?, project_id = ?, scene_id = ?,
        status = ?, duration_ms = ?, estimated_cost = ?, error_message = ?, request_json = ?,
        response_json = ?, media_refs_json = ?, error_json = ?, archived_at = NULL
    WHERE id = ?
  `)

  let inserted = 0
  db.transaction((items: LogPayload[]) => {
    for (const log of items) {
      const logId = randomUUID()
      const eventId = optionalString(log.eventId || log.event_id, 128) || null
      const requestId = optionalString(log.requestId || log.request_id, 128)
      const provider = optionalString(log.provider, 128)
      const modelId = optionalString(log.modelId || log.model_id, 256)
      const operation = optionalString(log.operation, 128)
      const projectId = optionalString(log.projectId || log.project_id, 128)
      const sceneId = optionalString(log.sceneId || log.scene_id, 128)
      const status = optionalString(log.status, 64) || 'unknown'
      const durationMs = Number(log.durationMs ?? log.duration_ms ?? 0) || 0
      const estimatedCost = Number(log.estimatedCost ?? log.estimated_cost ?? 0) || 0
      const errorMessage = optionalString(log.errorMessage || log.error_message, 4096)
      const requestJson = optionalJson(log.request) || {}
      const responseJson = optionalJson(log.response) || {}
      const mediaRefs = optionalJson(log.mediaRefs ?? log.media_refs) || []
      const errorJson = optionalJson(log.error) || {}
      const result = insert.run(
        logId,
        auth.user.id,
        eventId,
        requestId,
        provider,
        modelId,
        operation,
        projectId,
        sceneId,
        status,
        durationMs,
        estimatedCost,
        errorMessage,
        jsonText(requestJson),
        jsonText(responseJson),
        jsonText(mediaRefs),
        jsonText(errorJson),
        optionalString(log.createdAt || log.created_at, 64) || nowIso()
      )
      if (result.changes === 0) {
        if (eventId) {
          const existing = findExisting.get(auth.user.id, eventId) as {
            id: string
            response_json: string | null
            media_refs_json: string | null
          } | undefined
          if (existing) {
            updateExisting.run(
              requestId,
              provider,
              modelId,
              operation,
              projectId,
              sceneId,
              status,
              durationMs,
              estimatedCost,
              errorMessage,
              jsonText(requestJson),
              jsonText(mergeModelLogResponse(existing.response_json, responseJson)),
              jsonText(mergeModelLogMediaRefs(existing.media_refs_json, mediaRefs)),
              jsonText(errorJson),
              existing.id
            )
          }
        }
        continue
      }
      inserted += 1
      if (isBillableModelCallStatus(status)) {
        chargeModelCall({
          userId: auth.user.id,
          logId,
          operation,
          provider,
          modelId,
          request: requestJson
        })
      }
    }
  })(logs)

  archiveModelLogsIfNeeded(db, getAppSettings().logArchiveMaxRows, nowIso())

  return {
    success: true,
    data: {
      inserted,
      duplicates: logs.length - inserted
    }
  }
})
