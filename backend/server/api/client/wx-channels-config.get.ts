import { requireAuth } from '../../utils/auth'
import { writeAudit } from '../../utils/audit'
import {
  isWxChannelsConfigured,
  wxChannelsClientConfig,
  wxChannelsPublicConfig
} from '../../utils/wx-channels'
import { encryptedClientResponse } from '../../utils/secure-transport'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const publicConfig = wxChannelsPublicConfig()

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'client.wx_channels.fetch',
    targetType: 'wx_channels_config',
    metadata: {
      configured: isWxChannelsConfigured(),
      hasYuanbaoCookie: publicConfig.hasYuanbaoCookie
    }
  })

  return encryptedClientResponse(event, wxChannelsClientConfig())
})
