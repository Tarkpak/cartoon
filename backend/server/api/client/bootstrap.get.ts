import { getAppSettings, getDb, parseJsonText } from '../../utils/db'
import { requireAuth, publicUser } from '../../utils/auth'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const db = getDb()
  const providers = db
    .prepare(`
      SELECT p.id, p.provider_key, p.display_name, p.base_url, p.enabled,
             c.encrypted_api_key, c.encrypted_access_key, c.encrypted_secret_key
      FROM model_providers p
      LEFT JOIN provider_credentials c ON c.provider_id = p.id
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
    }>

  const preferences = db
    .prepare('SELECT workflow_step, model_id, model_options_json FROM user_model_preferences WHERE user_id = ? ORDER BY workflow_step ASC')
    .all(auth.user.id) as Array<{ workflow_step: string, model_id: string, model_options_json: string | null }>

  const defaultModelsRow = db
    .prepare("SELECT value FROM app_settings WHERE key = 'default_model_preferences' LIMIT 1")
    .get() as { value: string } | undefined

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
      defaultModelPreferences: parseJsonText(defaultModelsRow?.value, {}),
      modelPreferences: preferences.map(preference => ({
        workflowStep: preference.workflow_step,
        modelId: preference.model_id,
        modelOptions: parseJsonText(preference.model_options_json, {})
      }))
    }
  }
})

