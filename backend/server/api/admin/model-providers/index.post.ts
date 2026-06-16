import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { getDb, jsonText, nowIso } from '../../../utils/db'
import { encryptText } from '../../../utils/crypto'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { optionalString } from '../../../utils/http'
import { writeAudit } from '../../../utils/audit'
import { normalizeModelList } from '../../../utils/model-provider-models'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const body = await readJsonBody<{
    providerKey?: string
    displayName?: string
    baseUrl?: string
    enabled?: boolean
    apiKey?: string
    models?: unknown
    availableModels?: unknown
  }>(event)
  const providerKey = optionalString(body.providerKey, 64) || 'custom_openai'
  if (providerKey !== 'custom_openai') {
    throw createError({ statusCode: 400, statusMessage: 'Only custom_openai providers can be created' })
  }

  const timestamp = nowIso()
  const id = `custom_openai_${randomUUID()}`
  const models = normalizeModelList(body.models)
  const availableModels = normalizeModelList(body.availableModels)
  getDb()
    .prepare(`
      INSERT INTO custom_openai_providers
        (id, display_name, base_url, enabled, encrypted_api_key, models_json,
         available_models_json, synced_at, sync_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `)
    .run(
      id,
      optionalString(body.displayName, 128) || '自定义 OpenAI 兼容',
      optionalString(body.baseUrl, 512),
      body.enabled === false ? 0 : 1,
      encryptText(body.apiKey),
      jsonText(models),
      jsonText(availableModels),
      timestamp,
      timestamp
    )

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.model_providers.create',
    targetType: 'model_provider',
    targetId: id,
    metadata: { providerKey }
  })

  return { success: true, data: { id } }
})
