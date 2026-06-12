import { createError } from 'h3'
import { getDb, nowIso } from '../../../../utils/db'
import { encryptText } from '../../../../utils/crypto'
import { readJsonBody, requireAdmin } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { requiredParam } from '../../../../utils/http'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const providerId = requiredParam(event, 'id')
  const body = await readJsonBody<{
    apiKey?: string
    accessKey?: string
    secretKey?: string
    securityToken?: string
  }>(event)
  const db = getDb()
  const provider = db.prepare('SELECT id FROM model_providers WHERE id = ? LIMIT 1').get(providerId)
  if (!provider) {
    throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
  }
  db.prepare(`
    INSERT INTO provider_credentials
      (provider_id, encrypted_api_key, encrypted_access_key, encrypted_secret_key, encrypted_security_token, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id) DO UPDATE SET
      encrypted_api_key = excluded.encrypted_api_key,
      encrypted_access_key = excluded.encrypted_access_key,
      encrypted_secret_key = excluded.encrypted_secret_key,
      encrypted_security_token = excluded.encrypted_security_token,
      updated_at = excluded.updated_at
  `).run(
    providerId,
    encryptText(body.apiKey),
    encryptText(body.accessKey),
    encryptText(body.secretKey),
    encryptText(body.securityToken),
    nowIso()
  )

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.model_providers.credentials.update',
    targetType: 'model_provider',
    targetId: providerId,
    metadata: {
      hasApiKey: Boolean(body.apiKey),
      hasAccessKey: Boolean(body.accessKey),
      hasSecretKey: Boolean(body.secretKey),
      hasSecurityToken: Boolean(body.securityToken)
    }
  })

  return { success: true }
})
