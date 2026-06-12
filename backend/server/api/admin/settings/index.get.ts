import { getAppSettings } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler((event) => {
  requireAdmin(event)
  return {
    success: true,
    data: getAppSettings()
  }
})

