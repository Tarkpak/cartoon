import { createError } from 'h3'
import { getDb, parseJsonText } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { requiredParam } from '../../../utils/http'
import { writeAudit } from '../../../utils/audit'
import { redactLogPayload } from '../../../utils/log-redaction'

export default defineEventHandler((event) => {
  const auth = requireAdmin(event)
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

  const request = redactLogPayload(parseJsonText(log.request_json, {}))
  const response = redactLogPayload(parseJsonText(log.response_json, {}))
  const error = redactLogPayload(parseJsonText(log.error_json, {}))
  const safeLog = redactLogPayload({
    ...log,
    request_json: JSON.stringify(request),
    response_json: JSON.stringify(response),
    error_json: JSON.stringify(error),
    request,
    response,
    error
  })

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.model_call_logs.view',
    targetType: 'model_call_log',
    targetId: logId
  })

  return {
    success: true,
    data: {
      log: safeLog
    }
  }
})
