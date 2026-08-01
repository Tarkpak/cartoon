import { getDb } from '../../utils/db'
import { requireAuth } from '../../utils/auth'
import { decryptText } from '../../utils/crypto'
import { writeAudit } from '../../utils/audit'
import { encryptedClientResponse } from '../../utils/secure-transport'
import { listAdminProviderRows } from '../../utils/custom-openai-providers'
import { resolveProviderModelState } from '../../utils/model-provider-models'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const rows = listAdminProviderRows(getDb()).filter(row => Boolean(row.enabled))

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'client.provider_credentials.fetch',
    targetType: 'provider_credentials',
    metadata: { providerCount: rows.length }
  })

  return encryptedClientResponse(event, rows.map((row) => {
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
      baseUrl: row.base_url,
      apiKey: decryptText(row.encrypted_api_key),
      mediakitApiKey: row.provider_key === 'volcengine'
        ? decryptText(row.encrypted_mediakit_api_key)
        : '',
      arkAccessKey: row.provider_key === 'volcengine'
        ? decryptText(row.encrypted_ark_access_key)
        : '',
      arkSecretKey: row.provider_key === 'volcengine'
        ? decryptText(row.encrypted_ark_secret_key)
        : '',
      accessKey: decryptText(row.encrypted_access_key),
      secretKey: decryptText(row.encrypted_secret_key),
      securityToken: decryptText(row.encrypted_security_token),
      models: modelState.models,
      availableModels: modelState.availableModels
    }
  }))
})
