import { createError } from 'h3'
import { getDb, jsonText, nowIso } from '../../../../../utils/db'
import { decryptText } from '../../../../../utils/crypto'
import { requireAdmin } from '../../../../../utils/auth'
import { requiredParam } from '../../../../../utils/http'
import { writeAudit } from '../../../../../utils/audit'
import {
  parseOpenAICompatibleModelIds,
  providerModelsEndpoint,
  providerSupportsModelSync,
  providerSyncBaseUrl,
  resolveProviderModelState,
  retainEnabledModels
} from '../../../../../utils/model-provider-models'

async function fetchProviderModels(baseUrl: string, apiKey: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(providerModelsEndpoint(baseUrl), {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`)
    }
    const payload = JSON.parse(text) as unknown
    const modelIds = parseOpenAICompatibleModelIds(payload)
    if (modelIds.length === 0) {
      throw new Error('remote /models returned empty')
    }
    return modelIds
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('remote /models request timed out')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const providerId = requiredParam(event, 'id')
  const db = getDb()
  const provider = db
    .prepare(`
      SELECT p.id, p.provider_key, p.base_url,
             c.encrypted_api_key,
             m.models_json, m.available_models_json, m.synced_at, m.sync_error
      FROM model_providers p
      LEFT JOIN provider_credentials c ON c.provider_id = p.id
      LEFT JOIN model_provider_models m ON m.provider_id = p.id
      WHERE p.id = ?
      LIMIT 1
    `)
    .get(providerId) as {
      id: string
      provider_key: string
      base_url: string | null
      encrypted_api_key: string | null
      models_json: string | null
      available_models_json: string | null
      synced_at: string | null
      sync_error: string | null
    } | undefined
  if (!provider) {
    throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
  }
  if (!providerSupportsModelSync(provider.provider_key)) {
    throw createError({ statusCode: 400, statusMessage: 'Provider does not support model sync' })
  }

  const apiKey = decryptText(provider.encrypted_api_key)
  if (!apiKey) {
    throw createError({ statusCode: 400, statusMessage: 'Provider API Key is not configured' })
  }

  const baseUrl = providerSyncBaseUrl(provider.provider_key, provider.base_url)
  if (!baseUrl) {
    throw createError({ statusCode: 400, statusMessage: 'Provider Base URL is not configured' })
  }

  const current = resolveProviderModelState({
    providerKey: provider.provider_key,
    modelsJson: provider.models_json,
    availableModelsJson: provider.available_models_json,
    syncedAt: provider.synced_at,
    syncError: provider.sync_error
  })
  const timestamp = nowIso()

  try {
    const availableModels = await fetchProviderModels(baseUrl, apiKey)
    const nextModels = retainEnabledModels(current.models, availableModels)
    db.prepare(`
      INSERT INTO model_provider_models
        (provider_id, models_json, available_models_json, synced_at, sync_error, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?)
      ON CONFLICT(provider_id) DO UPDATE SET
        models_json = excluded.models_json,
        available_models_json = excluded.available_models_json,
        synced_at = excluded.synced_at,
        sync_error = excluded.sync_error,
        updated_at = excluded.updated_at
    `).run(
      provider.id,
      jsonText(nextModels),
      jsonText(availableModels),
      timestamp,
      timestamp
    )

    const updated = resolveProviderModelState({
      providerKey: provider.provider_key,
      modelsJson: jsonText(nextModels),
      availableModelsJson: jsonText(availableModels),
      syncedAt: timestamp,
      syncError: null
    })

    writeAudit(event, {
      actorUserId: auth.user.id,
      action: 'admin.model_providers.models.sync',
      targetType: 'model_provider',
      targetId: provider.id,
      metadata: {
        providerKey: provider.provider_key,
        availableModelCount: updated.availableModels.length,
        modelCount: updated.models.length
      }
    })

    return {
      success: true,
      data: {
        providerKey: provider.provider_key,
        modelCount: updated.models.length,
        models: updated.models,
        availableModels: updated.availableModels,
        availableModelCatalog: updated.availableModelCatalog,
        syncedAt: updated.syncedAt,
        syncError: updated.syncError
      }
    }
  } catch (error) {
    const syncError = error instanceof Error ? error.message : 'sync failed'
    db.prepare(`
      INSERT INTO model_provider_models
        (provider_id, models_json, available_models_json, synced_at, sync_error, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id) DO UPDATE SET
        synced_at = excluded.synced_at,
        sync_error = excluded.sync_error,
        updated_at = excluded.updated_at
    `).run(
      provider.id,
      jsonText(current.models),
      jsonText(current.availableModels),
      timestamp,
      syncError,
      timestamp
    )
    throw createError({ statusCode: 502, statusMessage: `Sync models failed: ${syncError}` })
  }
})
