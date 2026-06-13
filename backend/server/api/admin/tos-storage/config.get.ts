import { requireAdmin } from '../../../utils/auth'
import { tosStoragePublicConfig } from '../../../utils/tos-storage'

export default defineEventHandler((event) => {
  requireAdmin(event)
  return {
    success: true,
    data: tosStoragePublicConfig()
  }
})
