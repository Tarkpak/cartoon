import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { getDb, jsonText, nowIso } from '../../../utils/db'
import { encryptText } from '../../../utils/crypto'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { manualProviderSeedAvailableModels, normalizeModelList } from '../../../utils/model-provider-models'

const EXPORT_TYPE = 'playlet.model_providers'
const EXPORT_VERSION = 1
const PROVIDER_KEY_PATTERN = /^[a-z0-9_.-]+$/i

interface ProviderImportPayload extends Record<string, unknown> {
  type?: unknown
  version?: unknown
  providers?: unknown
}

interface NormalizedCredentials {
  apiKey: string
  accessKey: string
  secretKey: string
}

interface NormalizedProviderModels {
  models: string[]
  availableModels: string[]
  syncedAt: string | null
  syncError: string | null
}

interface NormalizedProvider {
  providerKey: string
  displayName: string
  baseUrl: string
  enabled: boolean
  credentials?: NormalizedCredentials
  modelConfig?: NormalizedProviderModels
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function mergeModelLists(primary: string[], secondary: string[]) {
  return normalizeModelList([...primary, ...secondary])
}

function normalizeProviderModels(provider: Record<string, unknown>, providerKey: string): NormalizedProviderModels | undefined {
  const modelsInput = provider.models ?? provider.selectedModels ?? provider.selected_models
  const availableInput = provider.availableModels ?? provider.available_models
  const hasModelConfig = Array.isArray(modelsInput)
    || Array.isArray(availableInput)
    || typeof provider.syncedAt === 'string'
    || typeof provider.synced_at === 'string'
    || typeof provider.syncError === 'string'
    || typeof provider.sync_error === 'string'
  if (!hasModelConfig) return undefined

  const models = normalizeModelList(modelsInput)
  const seedModels = manualProviderSeedAvailableModels(providerKey)
  const importedAvailableModels = normalizeModelList(availableInput)
  const availableModels = mergeModelLists(
    importedAvailableModels.length > 0 ? importedAvailableModels : seedModels,
    models
  )

  return {
    models,
    availableModels,
    syncedAt: stringValue(provider.syncedAt ?? provider.synced_at, 128) || null,
    syncError: stringValue(provider.syncError ?? provider.sync_error, 1024) || null
  }
}

function normalizeProvider(value: unknown, index: number): NormalizedProvider {
  const provider = asRecord(value)
  if (!provider) {
    throw createError({ statusCode: 400, statusMessage: `providers[${index}] must be an object` })
  }

  const providerKey = stringValue(provider.providerKey ?? provider.provider_key, 64).toLowerCase()
  if (!providerKey || !PROVIDER_KEY_PATTERN.test(providerKey)) {
    throw createError({ statusCode: 400, statusMessage: `providers[${index}].providerKey is invalid` })
  }

  const displayName = stringValue(provider.displayName ?? provider.display_name, 128) || providerKey
  const baseUrl = stringValue(provider.baseUrl ?? provider.base_url, 512)
  const credentials = asRecord(provider.credentials)
  const isKling = providerKey === 'kling'

  return {
    providerKey,
    displayName,
    baseUrl,
    enabled: provider.enabled === false ? false : true,
    credentials: credentials
      ? {
          apiKey: isKling ? '' : stringValue(credentials.apiKey, 4096),
          accessKey: isKling ? stringValue(credentials.accessKey, 4096) : '',
          secretKey: isKling ? stringValue(credentials.secretKey, 4096) : ''
        }
      : undefined,
    modelConfig: normalizeProviderModels(provider, providerKey)
  }
}

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const body = await readJsonBody<ProviderImportPayload>(event)
  if (body.type !== EXPORT_TYPE || body.version !== EXPORT_VERSION) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid provider config file' })
  }
  if (!Array.isArray(body.providers)) {
    throw createError({ statusCode: 400, statusMessage: 'providers must be an array' })
  }
  if (body.providers.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'providers is too large' })
  }

  const providers = body.providers.map(normalizeProvider)
  const timestamp = nowIso()
  const db = getDb()
  const selectProvider = db.prepare('SELECT id FROM model_providers WHERE provider_key = ? LIMIT 1')
  const insertProvider = db.prepare(`
    INSERT INTO model_providers
      (id, provider_key, display_name, base_url, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const updateProvider = db.prepare(`
    UPDATE model_providers
    SET display_name = ?, base_url = ?, enabled = ?, updated_at = ?
    WHERE id = ?
  `)
  const upsertCredentials = db.prepare(`
    INSERT INTO provider_credentials
      (provider_id, encrypted_api_key, encrypted_access_key, encrypted_secret_key, encrypted_security_token, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id) DO UPDATE SET
      encrypted_api_key = excluded.encrypted_api_key,
      encrypted_access_key = excluded.encrypted_access_key,
      encrypted_secret_key = excluded.encrypted_secret_key,
      encrypted_security_token = excluded.encrypted_security_token,
      updated_at = excluded.updated_at
  `)
  const upsertModels = db.prepare(`
    INSERT INTO model_provider_models
      (provider_id, models_json, available_models_json, synced_at, sync_error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id) DO UPDATE SET
      models_json = excluded.models_json,
      available_models_json = excluded.available_models_json,
      synced_at = excluded.synced_at,
      sync_error = excluded.sync_error,
      updated_at = excluded.updated_at
  `)

  const result = db.transaction((items: NormalizedProvider[]) => {
    let created = 0
    let updated = 0
    let credentialsUpdated = 0
    let modelSelectionsUpdated = 0

    for (const provider of items) {
      const existing = selectProvider.get(provider.providerKey) as { id: string } | undefined
      const providerId = existing?.id || randomUUID()
      if (existing) {
        updateProvider.run(
          provider.displayName,
          provider.baseUrl,
          provider.enabled ? 1 : 0,
          timestamp,
          providerId
        )
        updated += 1
      } else {
        insertProvider.run(
          providerId,
          provider.providerKey,
          provider.displayName,
          provider.baseUrl,
          provider.enabled ? 1 : 0,
          timestamp,
          timestamp
        )
        created += 1
      }

      if (provider.credentials) {
        upsertCredentials.run(
          providerId,
          encryptText(provider.credentials.apiKey),
          encryptText(provider.credentials.accessKey),
          encryptText(provider.credentials.secretKey),
          '',
          timestamp
        )
        credentialsUpdated += 1
      }

      if (provider.modelConfig) {
        upsertModels.run(
          providerId,
          jsonText(provider.modelConfig.models),
          jsonText(provider.modelConfig.availableModels),
          provider.modelConfig.syncedAt,
          provider.modelConfig.syncError,
          timestamp
        )
        modelSelectionsUpdated += 1
      }
    }

    return {
      created,
      updated,
      credentialsUpdated,
      modelSelectionsUpdated
    }
  })(providers)

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.model_providers.import',
    targetType: 'model_provider',
    metadata: {
      providerCount: providers.length,
      ...result
    }
  })

  return {
    success: true,
    data: result
  }
})
