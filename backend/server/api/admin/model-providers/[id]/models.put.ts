import { createError } from 'h3'
import { getDb, jsonText, nowIso } from '../../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../../utils/auth'
import { requiredParam } from '../../../../utils/http'
import { writeAudit } from '../../../../utils/audit'
import { normalizeModelList, resolveProviderModelState } from '../../../../utils/model-provider-models'
import { getAdminProviderRow } from '../../../../utils/custom-openai-providers'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const providerId = requiredParam(event, 'id')
  const body = await readJsonBody<{ models?: unknown }>(event)
  if (!Array.isArray(body.models)) {
    throw createError({ statusCode: 400, statusMessage: 'models must be an array' })
  }

  const db = getDb()
  const provider = getAdminProviderRow(db, providerId)
  if (!provider) {
    throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
  }
  const configured = provider.provider_key === 'kling'
    ? Boolean(provider.encrypted_access_key) && Boolean(provider.encrypted_secret_key)
    : ['custom_openai', 'openai'].includes(provider.provider_key)
        ? Boolean(provider.encrypted_api_key) && Boolean(provider.base_url)
        : Boolean(provider.encrypted_api_key)
  if (!configured) {
    throw createError({ statusCode: 400, statusMessage: 'Please configure provider credentials first' })
  }

  const current = resolveProviderModelState({
    providerKey: provider.provider_key,
    modelsJson: provider.models_json,
    availableModelsJson: provider.available_models_json,
    syncedAt: provider.synced_at,
    syncError: provider.sync_error
  })
  const requestedModels = normalizeModelList(body.models)
  const allowedModels = new Set([...current.availableModels, ...current.models])
  const invalidModels = requestedModels.filter(model => !allowedModels.has(model))
  if (invalidModels.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `models contains unavailable item: ${invalidModels.slice(0, 3).join(', ')}`
    })
  }

  const timestamp = nowIso()
  if (provider.source === 'custom_openai_extra') {
    db.prepare(`
      UPDATE custom_openai_providers
      SET models_json = ?, available_models_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      jsonText(requestedModels),
      jsonText(current.availableModels),
      timestamp,
      provider.id
    )
  } else {
  db.prepare(`
    INSERT INTO model_provider_models
      (provider_id, models_json, available_models_json, synced_at, sync_error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id) DO UPDATE SET
      models_json = excluded.models_json,
      available_models_json = excluded.available_models_json,
      updated_at = excluded.updated_at
  `).run(
    provider.id,
    jsonText(requestedModels),
    jsonText(current.availableModels),
    current.syncedAt,
    current.syncError,
    timestamp
  )
  }

  const updated = resolveProviderModelState({
    providerKey: provider.provider_key,
    modelsJson: jsonText(requestedModels),
    availableModelsJson: jsonText(current.availableModels),
    syncedAt: current.syncedAt,
    syncError: current.syncError
  })

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.model_providers.models.update',
    targetType: 'model_provider',
    targetId: provider.id,
    metadata: {
      providerKey: provider.provider_key,
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
})
