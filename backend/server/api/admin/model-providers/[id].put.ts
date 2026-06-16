import { createError } from 'h3'
import { getDb, nowIso } from '../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { optionalString, requiredParam } from '../../../utils/http'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const providerId = requiredParam(event, 'id')
  const body = await readJsonBody<{
    displayName?: string
    baseUrl?: string
    enabled?: boolean
  }>(event)
  const timestamp = nowIso()
  const db = getDb()
  const extraResult = db
    .prepare(`
      UPDATE custom_openai_providers
      SET display_name = COALESCE(NULLIF(?, ''), display_name),
          base_url = ?,
          enabled = ?,
          updated_at = ?
      WHERE id = ?
    `)
    .run(
      optionalString(body.displayName, 128),
      optionalString(body.baseUrl, 512),
      body.enabled === false ? 0 : 1,
      timestamp,
      providerId
    )
  if (extraResult.changes > 0) {
    writeAudit(event, {
      actorUserId: auth.user.id,
      action: 'admin.model_providers.update',
      targetType: 'model_provider',
      targetId: providerId,
      metadata: { source: 'custom_openai_extra' }
    })
    return { success: true }
  }

  const result = db
    .prepare(`
      UPDATE model_providers
      SET display_name = COALESCE(NULLIF(?, ''), display_name),
          base_url = ?,
          enabled = ?,
          updated_at = ?
      WHERE id = ?
    `)
    .run(
      optionalString(body.displayName, 128),
      optionalString(body.baseUrl, 512),
      body.enabled === false ? 0 : 1,
      timestamp,
      providerId
    )
  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
  }
  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.model_providers.update',
    targetType: 'model_provider',
    targetId: providerId
  })
  return { success: true }
})
