import { getDb } from '../../utils/db'
import { requireAuth } from '../../utils/auth'
import { decryptText } from '../../utils/crypto'
import { writeAudit } from '../../utils/audit'
import { encryptedClientResponse } from '../../utils/secure-transport'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const rows = getDb()
    .prepare(`
      SELECT p.provider_key, p.display_name, p.base_url, p.enabled,
             c.encrypted_api_key, c.encrypted_access_key, c.encrypted_secret_key, c.encrypted_security_token
      FROM model_providers p
      LEFT JOIN provider_credentials c ON c.provider_id = p.id
      WHERE p.enabled = 1
      ORDER BY p.display_name ASC
    `)
    .all() as Array<{
      provider_key: string
      display_name: string
      base_url: string
      enabled: number
      encrypted_api_key: string
      encrypted_access_key: string
      encrypted_secret_key: string
      encrypted_security_token: string
    }>

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'client.provider_credentials.fetch',
    targetType: 'provider_credentials',
    metadata: { providerCount: rows.length }
  })

  return encryptedClientResponse(event, rows.map(row => ({
    providerKey: row.provider_key,
    displayName: row.display_name,
    baseUrl: row.base_url,
    apiKey: decryptText(row.encrypted_api_key),
    accessKey: decryptText(row.encrypted_access_key),
    secretKey: decryptText(row.encrypted_secret_key),
    securityToken: decryptText(row.encrypted_security_token)
  })))
})
