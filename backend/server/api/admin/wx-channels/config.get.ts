import { requireAdmin } from '../../../utils/auth'
import { wxChannelsPublicConfig } from '../../../utils/wx-channels'

export default defineEventHandler((event) => {
  requireAdmin(event)
  return {
    success: true,
    data: wxChannelsPublicConfig()
  }
})
