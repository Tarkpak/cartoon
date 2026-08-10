import { setResponseHeader } from 'h3'
import { getDb, nowIso } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { decryptText } from '../../../utils/crypto'
import { writeAudit } from '../../../utils/audit'
import { resolveProviderModelState } from '../../../utils/model-provider-models'
import { listAdminProviderRows } from '../../../utils/custom-openai-providers'

const EXPORT_TYPE = 'playlet.model_providers'
const EXPORT_VERSION = 1

export default defineEventHandler((event) => {
  const auth = requireAdmin(event)
  const exportedAt = nowIso()
  const rows = listAdminProviderRows(getDb())

  const payload = {
    type: EXPORT_TYPE,
    version: EXPORT_VERSION,
    exportedAt,
    providers: rows.map(row => {
      const credentials = row.provider_key === 'kling'
        ? {
            accessKey: decryptText(row.encrypted_access_key),
            secretKey: decryptText(row.encrypted_secret_key)
          }
        : {
            apiKey: decryptText(row.encrypted_api_key),
            speechApiKey: row.provider_key === 'volcengine'
              ? decryptText(row.encrypted_speech_api_key)
              : undefined,
            mediakitApiKey: row.provider_key === 'volcengine'
              ? decryptText(row.encrypted_mediakit_api_key)
              : undefined,
            arkAccessKey: row.provider_key === 'volcengine'
              ? decryptText(row.encrypted_ark_access_key)
              : undefined,
            arkSecretKey: row.provider_key === 'volcengine'
              ? decryptText(row.encrypted_ark_secret_key)
              : undefined
          }
      const modelState = resolveProviderModelState({
        providerKey: row.provider_key,
        modelsJson: row.models_json,
        availableModelsJson: row.available_models_json,
        syncedAt: row.synced_at,
        syncError: row.sync_error
      })
      return {
        id: row.id,
        providerKey: row.provider_key,
        displayName: row.display_name,
        baseUrl: row.base_url || '',
        enabled: Boolean(row.enabled),
        credentials,
        models: modelState.models,
        availableModels: modelState.availableModels,
        syncedAt: modelState.syncedAt,
        syncError: modelState.syncError
      }
    })
  }

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.model_providers.export',
    targetType: 'model_provider',
    metadata: {
      providerCount: payload.providers.length
    }
  })

  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  setResponseHeader(
    event,
    'content-disposition',
    `attachment; filename="playlet-model-providers-${exportedAt.slice(0, 10)}.json"`
  )
  return payload
})
