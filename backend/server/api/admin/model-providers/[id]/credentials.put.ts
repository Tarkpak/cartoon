import { createError } from 'h3'
import { getDb, nowIso } from '../../../../utils/db'
import { decryptText, encryptText } from '../../../../utils/crypto'
import { readJsonBody, requireAdmin } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { requiredParam } from '../../../../utils/http'
import { getAdminProviderRow } from '../../../../utils/custom-openai-providers'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const providerId = requiredParam(event, 'id')
  const body = await readJsonBody<{
    apiKey?: string
    mediakitApiKey?: string
    accessKey?: string
    secretKey?: string
  }>(event)
  const db = getDb()
  const provider = getAdminProviderRow(db, providerId)
  if (!provider) {
    throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
  }
  const isKling = provider.provider_key === 'kling'
  if (provider.source === 'custom_openai_extra') {
    db.prepare(`
      UPDATE custom_openai_providers
      SET encrypted_api_key = ?, updated_at = ?
      WHERE id = ?
    `).run(
      encryptText(body.apiKey),
      nowIso(),
      providerId
    )
  } else {
    const existingCredentials = db.prepare(`
      SELECT encrypted_api_key, encrypted_mediakit_api_key, encrypted_access_key, encrypted_secret_key
      FROM provider_credentials
      WHERE provider_id = ?
      LIMIT 1
    `).get(providerId) as {
      encrypted_api_key?: string | null
      encrypted_mediakit_api_key?: string | null
      encrypted_access_key?: string | null
      encrypted_secret_key?: string | null
    } | undefined
    const previous = {
      apiKey: decryptText(existingCredentials?.encrypted_api_key),
      mediakitApiKey: decryptText(existingCredentials?.encrypted_mediakit_api_key),
      accessKey: decryptText(existingCredentials?.encrypted_access_key),
      secretKey: decryptText(existingCredentials?.encrypted_secret_key)
    }
    const next = {
      apiKey: isKling ? '' : (body.apiKey === undefined ? previous.apiKey : body.apiKey),
      mediakitApiKey: provider.provider_key === 'volcengine'
        ? (body.mediakitApiKey === undefined ? previous.mediakitApiKey : body.mediakitApiKey)
        : '',
      accessKey: isKling ? (body.accessKey === undefined ? previous.accessKey : body.accessKey) : '',
      secretKey: isKling ? (body.secretKey === undefined ? previous.secretKey : body.secretKey) : ''
    }

    db.prepare(`
    INSERT INTO provider_credentials
      (provider_id, encrypted_api_key, encrypted_mediakit_api_key, encrypted_access_key, encrypted_secret_key, encrypted_security_token, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id) DO UPDATE SET
      encrypted_api_key = excluded.encrypted_api_key,
      encrypted_mediakit_api_key = excluded.encrypted_mediakit_api_key,
      encrypted_access_key = excluded.encrypted_access_key,
      encrypted_secret_key = excluded.encrypted_secret_key,
      encrypted_security_token = excluded.encrypted_security_token,
      updated_at = excluded.updated_at
  `).run(
      providerId,
      encryptText(next.apiKey),
      encryptText(next.mediakitApiKey),
      encryptText(next.accessKey),
      encryptText(next.secretKey),
      '',
      nowIso()
    )
  }

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.model_providers.credentials.update',
    targetType: 'model_provider',
    targetId: providerId,
    metadata: {
      credentialMode: isKling ? 'access_secret' : 'api_key',
      hasApiKey: !isKling && Boolean(body.apiKey),
      hasMediakitApiKey: provider.provider_key === 'volcengine' && Boolean(body.mediakitApiKey),
      hasAccessKey: isKling && Boolean(body.accessKey),
      hasSecretKey: isKling && Boolean(body.secretKey)
    }
  })

  return { success: true }
})
