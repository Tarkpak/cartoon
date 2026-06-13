import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import {
  isTosStorageConfigured,
  saveTosStorageConfig,
  tosStoragePublicConfig,
  type TosStorageConfigInput
} from '../../../utils/tos-storage'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const body = await readJsonBody<TosStorageConfigInput>(event)
  const row = saveTosStorageConfig(body)

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.tos_storage.update',
    targetType: 'tos_storage_config',
    targetId: 'default',
    metadata: {
      enabled: Boolean(row?.enabled),
      configured: isTosStorageConfigured(row),
      hasSecretKey: Boolean(row?.encrypted_secret_key),
      hasSecurityToken: Boolean(row?.encrypted_security_token)
    }
  })

  return {
    success: true,
    data: tosStoragePublicConfig(row)
  }
})
