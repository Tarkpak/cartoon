import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { getDb, jsonText, nowIso } from '../../../utils/db'
import { readJsonBody, requireAuth } from '../../../utils/auth'
import { optionalJson, optionalString } from '../../../utils/http'

interface PreferencePayload {
  workflowStep?: string
  workflow_step?: string
  step?: string
  modelId?: string
  model_id?: string
  modelOptions?: unknown
  model_options?: unknown
}

function normalizePreferences(body: Record<string, unknown>) {
  if (Array.isArray(body.preferences)) return body.preferences as PreferencePayload[]
  if (Array.isArray(body.items)) return body.items as PreferencePayload[]
  return [body as PreferencePayload]
}

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readJsonBody<Record<string, unknown>>(event)
  const preferences = normalizePreferences(body)
  if (preferences.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'preferences is required' })
  }

  const db = getDb()
  const timestamp = nowIso()
  const upsert = db.prepare(`
    INSERT INTO user_model_preferences
      (id, user_id, workflow_step, model_id, model_options_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, workflow_step) DO UPDATE SET
      model_id = excluded.model_id,
      model_options_json = excluded.model_options_json,
      updated_at = excluded.updated_at
  `)
  db.transaction((items: PreferencePayload[]) => {
    for (const preference of items) {
      const workflowStep = optionalString(preference.workflowStep || preference.workflow_step || preference.step, 128)
      const modelId = optionalString(preference.modelId || preference.model_id, 256)
      if (!workflowStep || !modelId) continue
      upsert.run(
        randomUUID(),
        auth.user.id,
        workflowStep,
        modelId,
        jsonText(optionalJson(preference.modelOptions ?? preference.model_options) || {}),
        timestamp,
        timestamp
      )
    }
  })(preferences)

  return { success: true }
})

