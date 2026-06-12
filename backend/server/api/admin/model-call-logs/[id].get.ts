import { createError } from 'h3'
import { getDb, parseJsonText } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { requiredParam } from '../../../utils/http'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const logId = requiredParam(event, 'id')
  const log = getDb()
    .prepare(`
      SELECT l.*, u.account, u.display_name
      FROM model_call_logs l
      LEFT JOIN users u ON u.id = l.user_id
      WHERE l.id = ?
      LIMIT 1
    `)
    .get(logId) as {
      request_json?: string
      response_json?: string
      error_json?: string
    } | undefined
  if (!log) {
    throw createError({ statusCode: 404, statusMessage: 'Log not found' })
  }

  return {
    success: true,
    data: {
      log: {
        ...log,
        request: parseJsonText(log.request_json, {}),
        response: parseJsonText(log.response_json, {}),
        error: parseJsonText(log.error_json, {})
      }
    }
  }
})
