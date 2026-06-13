import { getAppSettings, getDb, parseJsonText } from '../../utils/db'
import { requireAuth, publicUser } from '../../utils/auth'
import { resolveProviderModelState } from '../../utils/model-provider-models'
import { tosStoragePublicConfig } from '../../utils/tos-storage'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const db = getDb()
  const providers = db
    .prepare(`
      SELECT p.id, p.provider_key, p.display_name, p.base_url, p.enabled,
             c.encrypted_api_key, c.encrypted_access_key, c.encrypted_secret_key,
             m.models_json, m.available_models_json, m.synced_at, m.sync_error
      FROM model_providers p
      LEFT JOIN provider_credentials c ON c.provider_id = p.id
      LEFT JOIN model_provider_models m ON m.provider_id = p.id
      ORDER BY p.display_name ASC
    `)
    .all() as Array<{
      id: string
      provider_key: string
      display_name: string
      base_url: string
      enabled: number
      encrypted_api_key: string
      encrypted_access_key: string
      encrypted_secret_key: string
      models_json: string | null
      available_models_json: string | null
      synced_at: string | null
      sync_error: string | null
    }>

  const preferences = db
    .prepare('SELECT workflow_step, model_id, model_options_json FROM user_model_preferences WHERE user_id = ? ORDER BY workflow_step ASC')
    .all(auth.user.id) as Array<{ workflow_step: string, model_id: string, model_options_json: string | null }>

  const defaultModelsRow = db
    .prepare("SELECT value FROM app_settings WHERE key = 'default_model_preferences' LIMIT 1")
    .get() as { value: string } | undefined
  const providerModels = providers.map((provider) => {
    const modelState = resolveProviderModelState({
      providerKey: provider.provider_key,
      modelsJson: provider.models_json,
      availableModelsJson: provider.available_models_json,
      syncedAt: provider.synced_at,
      syncError: provider.sync_error
    })
    const configured = provider.provider_key === 'kling'
      ? Boolean(provider.encrypted_access_key) && Boolean(provider.encrypted_secret_key)
      : ['custom_openai', 'openai'].includes(provider.provider_key)
          ? Boolean(provider.encrypted_api_key) && Boolean(provider.base_url)
          : Boolean(provider.encrypted_api_key)
    const enabled = Boolean(provider.enabled) && configured
    return {
      providerKey: provider.provider_key,
      models: enabled ? modelState.models : [],
      availableModels: enabled ? modelState.availableModels : []
    }
  })

  return {
    success: true,
    data: {
      user: publicUser(auth.user),
      deviceId: auth.deviceId,
      settings: getAppSettings(),
      keyFetchPolicy: 'startup',
      allowUserModelOverride: true,
      allowPromptCustomization: true,
      providers: providers.map(provider => ({
        id: provider.id,
        providerKey: provider.provider_key,
        displayName: provider.display_name,
        baseUrl: provider.base_url,
        enabled: Boolean(provider.enabled),
        hasApiKey: Boolean(provider.encrypted_api_key),
        hasAccessKey: Boolean(provider.encrypted_access_key),
        hasSecretKey: Boolean(provider.encrypted_secret_key)
      })),
      tosStorageConfig: tosStoragePublicConfig(),
      providerModels,
      allowedModelsByProvider: Object.fromEntries(
        providerModels.map(provider => [provider.providerKey, provider.models])
      ),
      defaultModelPreferences: parseJsonText(defaultModelsRow?.value, {}),
      modelPreferences: preferences.map(preference => ({
        workflowStep: preference.workflow_step,
        modelId: preference.model_id,
        modelOptions: parseJsonText(preference.model_options_json, {})
      }))
    }
  }
})
