import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { listAdminProviderRows, providerRowToApi } from '../../../utils/custom-openai-providers'

export default defineEventHandler((event) => {
  requireAdmin(event)
  return {
    success: true,
    data: {
      providers: listAdminProviderRows(getDb()).map(providerRowToApi)
    }
  }
})
