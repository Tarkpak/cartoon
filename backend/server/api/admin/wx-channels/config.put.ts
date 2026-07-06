import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import {
  isWxChannelsConfigured,
  saveWxChannelsConfig,
  wxChannelsPublicConfig,
  type WxChannelsConfigInput
} from '../../../utils/wx-channels'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const body = await readJsonBody<WxChannelsConfigInput>(event)
  const row = saveWxChannelsConfig(body)

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.wx_channels.update',
    targetType: 'wx_channels_config',
    targetId: 'default',
    metadata: {
      configured: isWxChannelsConfigured(row),
      clear: body.clear === true
    }
  })

  return {
    success: true,
    data: wxChannelsPublicConfig(row)
  }
})
