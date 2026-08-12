import { getAppSettings, getDb, parseJsonText } from '../../utils/db'
import { requireAuth, publicUser } from '../../utils/auth'
import { resolveProviderModelState } from '../../utils/model-provider-models'
import { tosStoragePublicConfig } from '../../utils/tos-storage'
import { listAdminProviderRows } from '../../utils/custom-openai-providers'
import { wxChannelsPublicConfig } from '../../utils/wx-channels'
import { getCreditAccount } from '../../utils/credits'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const db = getDb()
  const providers = listAdminProviderRows(db)
  const creditAccount = getCreditAccount(auth.user.id)

  const preferences = db
    .prepare('SELECT workflow_step, model_id, model_options_json FROM user_model_preferences WHERE user_id = ? ORDER BY workflow_step ASC')
    .all(auth.user.id) as Array<{ workflow_step: string, model_id: string, model_options_json: string | null }>

  const defaultModelsRow = db
    .prepare("SELECT value FROM app_settings WHERE key = 'default_model_preferences' LIMIT 1")
    .get() as { value: string } | undefined
  const providerModelItems = providers.map((provider) => {
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
  const providerModelsByKey = new Map<string, { providerKey: string, models: string[], availableModels: string[] }>()
  for (const provider of providerModelItems) {
    const current = providerModelsByKey.get(provider.providerKey)
    if (!current) {
      providerModelsByKey.set(provider.providerKey, {
        providerKey: provider.providerKey,
        models: [...provider.models],
        availableModels: [...provider.availableModels]
      })
      continue
    }
    current.models = Array.from(new Set([...current.models, ...provider.models]))
    current.availableModels = Array.from(new Set([...current.availableModels, ...provider.availableModels]))
  }
  const providerModels = Array.from(providerModelsByKey.values())

  const promptTemplateDefaults = db
    .prepare('SELECT template_key, title, content, updated_at FROM system_prompt_templates ORDER BY template_key ASC')
    .all()
    .map(row => {
      const item = row as { template_key: string, title: string | null, content: string, updated_at: string }
      return {
        templateKey: item.template_key,
        title: item.title,
        content: item.content,
        updatedAt: item.updated_at
      }
    })

  return {
    success: true,
    data: {
      user: {
        ...publicUser(auth.user),
        creditBalance: creditAccount.balance
      },
      creditAccount,
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
      wxChannelsConfig: wxChannelsPublicConfig(),
      providerModels,
      allowedModelsByProvider: Object.fromEntries(
        providerModels.map(provider => [provider.providerKey, provider.models])
      ),
      defaultModelPreferences: parseJsonText(defaultModelsRow?.value, {}),
      promptTemplateDefaults,
      modelPreferences: preferences.map(preference => ({
        workflowStep: preference.workflow_step,
        modelId: preference.model_id,
        modelOptions: parseJsonText(preference.model_options_json, {})
      }))
    }
  }
})
