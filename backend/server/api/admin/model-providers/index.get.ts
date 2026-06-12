import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const providers = getDb()
    .prepare(`
      SELECT p.id, p.provider_key, p.display_name, p.base_url, p.enabled, p.created_at, p.updated_at,
             c.encrypted_api_key, c.encrypted_access_key, c.encrypted_secret_key, c.encrypted_security_token, c.updated_at AS credentials_updated_at
      FROM model_providers p
      LEFT JOIN provider_credentials c ON c.provider_id = p.id
      ORDER BY p.display_name ASC
    `)
    .all() as Array<Record<string, unknown> & {
      encrypted_api_key?: string
      encrypted_access_key?: string
      encrypted_secret_key?: string
      encrypted_security_token?: string
    }>

  return {
    success: true,
    data: {
      providers: providers.map(provider => ({
        id: provider.id,
        providerKey: provider.provider_key,
        displayName: provider.display_name,
        baseUrl: provider.base_url,
        enabled: Boolean(provider.enabled),
        createdAt: provider.created_at,
        updatedAt: provider.updated_at,
        credentialsUpdatedAt: provider.credentials_updated_at,
        hasApiKey: Boolean(provider.encrypted_api_key),
        hasAccessKey: Boolean(provider.encrypted_access_key),
        hasSecretKey: Boolean(provider.encrypted_secret_key),
        hasSecurityToken: Boolean(provider.encrypted_security_token)
      }))
    }
  }
})

