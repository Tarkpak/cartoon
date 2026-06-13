import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { providerSupportsModelSync, resolveProviderModelState } from '../../../utils/model-provider-models'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const providers = getDb()
    .prepare(`
      SELECT p.id, p.provider_key, p.display_name, p.base_url, p.enabled, p.created_at, p.updated_at,
             c.encrypted_api_key, c.encrypted_access_key, c.encrypted_secret_key, c.updated_at AS credentials_updated_at,
             m.models_json, m.available_models_json, m.synced_at, m.sync_error
      FROM model_providers p
      LEFT JOIN provider_credentials c ON c.provider_id = p.id
      LEFT JOIN model_provider_models m ON m.provider_id = p.id
      ORDER BY p.display_name ASC
    `)
    .all() as Array<Record<string, unknown> & {
      encrypted_api_key?: string
      encrypted_access_key?: string
      encrypted_secret_key?: string
      models_json?: string | null
      available_models_json?: string | null
      synced_at?: string | null
      sync_error?: string | null
    }>

  return {
    success: true,
    data: {
      providers: providers.map((provider) => {
        const providerKey = String(provider.provider_key || '')
        const modelState = resolveProviderModelState({
          providerKey,
          modelsJson: provider.models_json,
          availableModelsJson: provider.available_models_json,
          syncedAt: provider.synced_at,
          syncError: provider.sync_error
        })

        const hasApiKey = Boolean(provider.encrypted_api_key)
        const hasAccessKey = Boolean(provider.encrypted_access_key)
        const hasSecretKey = Boolean(provider.encrypted_secret_key)
        const configured = providerKey === 'kling'
          ? hasAccessKey && hasSecretKey
          : ['custom_openai', 'openai'].includes(providerKey)
              ? hasApiKey && Boolean(provider.base_url)
              : hasApiKey
        const models = configured ? modelState.models : []
        const availableModels = configured ? modelState.availableModels : []

        return {
          id: provider.id,
          providerKey,
          displayName: provider.display_name,
          baseUrl: provider.base_url,
          enabled: Boolean(provider.enabled),
          createdAt: provider.created_at,
          updatedAt: provider.updated_at,
          credentialsUpdatedAt: provider.credentials_updated_at,
          hasApiKey,
          hasAccessKey,
          hasSecretKey,
          configured,
          supportedDynamicSync: providerSupportsModelSync(providerKey),
          modelCount: models.length,
          models,
          availableModels,
          availableModelCatalog: configured ? modelState.availableModelCatalog : [],
          syncedAt: modelState.syncedAt,
          syncError: modelState.syncError
        }
      })
    }
  }
})
