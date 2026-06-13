import { requireAuth } from '../../utils/auth'
import { writeAudit } from '../../utils/audit'
import {
  isTosStorageConfigured,
  tosStorageClientConfig,
  tosStoragePublicConfig
} from '../../utils/tos-storage'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const publicConfig = tosStoragePublicConfig()

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'client.tos_storage.fetch',
    targetType: 'tos_storage_config',
    metadata: {
      enabled: publicConfig.enabled,
      configured: isTosStorageConfigured(),
      hasSecretKey: publicConfig.hasSecretKey,
      hasSecurityToken: publicConfig.hasSecurityToken
    }
  })

  return {
    success: true,
    data: tosStorageClientConfig()
  }
})
