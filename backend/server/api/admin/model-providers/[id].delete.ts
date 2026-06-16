import { createError } from 'h3'
import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { requiredParam } from '../../../utils/http'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler((event) => {
  const auth = requireAdmin(event)
  const providerId = requiredParam(event, 'id')
  const result = getDb()
    .prepare('DELETE FROM custom_openai_providers WHERE id = ?')
    .run(providerId)

  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Provider not found or cannot be deleted' })
  }

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.model_providers.delete',
    targetType: 'model_provider',
    targetId: providerId,
    metadata: { source: 'custom_openai_extra' }
  })

  return { success: true }
})
