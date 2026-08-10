import type { Database } from 'bun:sqlite'
import { createError } from 'h3'
import { buildAvailableModelCatalog, resolveProviderModelState } from './model-provider-models'

export interface AdminProviderRow {
  id: string
  provider_key: string
  display_name: string
  base_url: string | null
  enabled: number
  created_at?: string
  updated_at?: string
  encrypted_api_key?: string | null
  encrypted_speech_api_key?: string | null
  encrypted_mediakit_api_key?: string | null
  encrypted_ark_access_key?: string | null
  encrypted_ark_secret_key?: string | null
  encrypted_access_key?: string | null
  encrypted_secret_key?: string | null
  encrypted_security_token?: string | null
  credentials_updated_at?: string | null
  models_json?: string | null
  available_models_json?: string | null
  synced_at?: string | null
  sync_error?: string | null
  source: 'core' | 'custom_openai_extra'
}

export interface ProviderApiShape {
  id: string
  providerKey: string
  displayName: string
  baseUrl: string
  enabled: boolean
  createdAt?: string
  updatedAt?: string
  credentialsUpdatedAt?: string | null
  hasApiKey: boolean
  hasSpeechApiKey: boolean
  hasMediakitApiKey: boolean
  hasArkAccessKey: boolean
  hasArkSecretKey: boolean
  hasAccessKey: boolean
  hasSecretKey: boolean
  configured: boolean
  supportedDynamicSync: boolean
  modelCount: number
  models: string[]
  availableModels: string[]
  availableModelCatalog: ReturnType<typeof buildAvailableModelCatalog>
  syncedAt: string | null
  syncError: string | null
  source: 'core' | 'custom_openai_extra'
  canDelete: boolean
}

export function listCoreProviderRows(db: Database): AdminProviderRow[] {
  return db
    .prepare(`
      SELECT p.id, p.provider_key, p.display_name, p.base_url, p.enabled, p.created_at, p.updated_at,
             c.encrypted_api_key, c.encrypted_speech_api_key, c.encrypted_mediakit_api_key, c.encrypted_ark_access_key, c.encrypted_ark_secret_key,
             c.encrypted_access_key, c.encrypted_secret_key,
             c.encrypted_security_token, c.updated_at AS credentials_updated_at,
             m.models_json, m.available_models_json, m.synced_at, m.sync_error
      FROM model_providers p
      LEFT JOIN provider_credentials c ON c.provider_id = p.id
      LEFT JOIN model_provider_models m ON m.provider_id = p.id
      ORDER BY p.display_name ASC
    `)
    .all()
    .map(row => ({ ...(row as Omit<AdminProviderRow, 'source'>), source: 'core' as const }))
}

export function listExtraCustomOpenAIProviderRows(db: Database): AdminProviderRow[] {
  return db
    .prepare(`
      SELECT id, 'custom_openai' AS provider_key, display_name, base_url, enabled,
             created_at, updated_at, encrypted_api_key, '' AS encrypted_speech_api_key, '' AS encrypted_mediakit_api_key,
             '' AS encrypted_ark_access_key, '' AS encrypted_ark_secret_key, '' AS encrypted_access_key,
             '' AS encrypted_secret_key, '' AS encrypted_security_token,
             updated_at AS credentials_updated_at, models_json, available_models_json,
             synced_at, sync_error
      FROM custom_openai_providers
      ORDER BY display_name ASC
    `)
    .all()
    .map(row => ({ ...(row as Omit<AdminProviderRow, 'source'>), source: 'custom_openai_extra' as const }))
}

export function listAdminProviderRows(db: Database): AdminProviderRow[] {
  return [
    ...listCoreProviderRows(db),
    ...listExtraCustomOpenAIProviderRows(db)
  ].sort((left, right) => left.display_name.localeCompare(right.display_name))
}

export function providerRowToApi(row: AdminProviderRow): ProviderApiShape {
  const providerKey = String(row.provider_key || '')
  const modelState = resolveProviderModelState({
    providerKey,
    modelsJson: row.models_json,
    availableModelsJson: row.available_models_json,
    syncedAt: row.synced_at,
    syncError: row.sync_error
  })
  const hasApiKey = Boolean(row.encrypted_api_key)
  const hasSpeechApiKey = Boolean(row.encrypted_speech_api_key)
  const hasMediakitApiKey = Boolean(row.encrypted_mediakit_api_key)
  const hasArkAccessKey = Boolean(row.encrypted_ark_access_key)
  const hasArkSecretKey = Boolean(row.encrypted_ark_secret_key)
  const hasAccessKey = Boolean(row.encrypted_access_key)
  const hasSecretKey = Boolean(row.encrypted_secret_key)
  const configured = providerKey === 'kling'
    ? hasAccessKey && hasSecretKey
    : ['custom_openai', 'openai'].includes(providerKey)
        ? hasApiKey && Boolean(row.base_url)
        : hasApiKey
  const models = configured ? modelState.models : []
  const availableModels = configured ? modelState.availableModels : []

  return {
    id: row.id,
    providerKey,
    displayName: row.display_name,
    baseUrl: row.base_url || '',
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    credentialsUpdatedAt: row.credentials_updated_at || null,
    hasApiKey,
    hasSpeechApiKey,
    hasMediakitApiKey,
    hasArkAccessKey,
    hasArkSecretKey,
    hasAccessKey,
    hasSecretKey,
    configured,
    supportedDynamicSync: providerKey === 'custom_openai' || providerKey === 'openai'
      ? true
      : ['qwen', 'volcengine', 'deepseek'].includes(providerKey),
    modelCount: models.length,
    models,
    availableModels,
    availableModelCatalog: configured ? modelState.availableModelCatalog : [],
    syncedAt: modelState.syncedAt,
    syncError: modelState.syncError,
    source: row.source,
    canDelete: row.source === 'custom_openai_extra'
  }
}

export function getAdminProviderRow(db: Database, providerId: string): AdminProviderRow | undefined {
  return listAdminProviderRows(db).find(row => row.id === providerId)
}

export function requireAdminProviderRow(db: Database, providerId: string) {
  const provider = getAdminProviderRow(db, providerId)
  if (!provider) {
    throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
  }
  return provider
}
