import { getQuery } from 'h3'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { queryAdminModelUsage } from '../../utils/admin-model-usage'

export default defineEventHandler((event) => {
  requireAdmin(event)
  return { success: true, data: queryAdminModelUsage(getDb(), getQuery(event)) }
})
