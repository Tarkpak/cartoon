import { getDb } from '../../utils/db'
import { readJsonBody, requireAuth } from '../../utils/auth'
import { saveModelUsage } from '../../utils/model-usage'

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const body = await readJsonBody<{ records?: unknown[] }>(event)
  if (!Array.isArray(body.records) || body.records.length > 100) throw createError({ statusCode: 400, message: '用量批次无效' })
  const db = getDb()
  db.transaction(() => {
    for (const record of body.records!) {
      const id = record && typeof record === 'object' && 'id' in record && typeof record.id === 'string' ? record.id : null
      saveModelUsage(db, user.id, id, record)
    }
  })()
  return { success: true }
})
