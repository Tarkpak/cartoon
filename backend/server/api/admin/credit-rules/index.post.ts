import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { getDb, nowIso } from '../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { optionalString, requiredString } from '../../../utils/http'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const body = await readJsonBody<{
    operation?: string
    provider?: string
    modelId?: string
    credits?: number
    enabled?: boolean
  }>(event)
  const operation = requiredString(body.operation, 'operation', 128)
  const provider = optionalString(body.provider, 128)
  const modelId = optionalString(body.modelId, 256)
  const credits = Number(body.credits)
  if (!Number.isSafeInteger(credits) || credits < 0 || credits > 1_000_000) {
    throw createError({ statusCode: 400, statusMessage: '积分规则不合法' })
  }
  const db = getDb()
  const existing = db.prepare(`
    SELECT id FROM credit_rules WHERE operation = ? AND provider = ? AND model_id = ? LIMIT 1
  `).get(operation, provider, modelId)
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: '相同范围的积分规则已存在' })
  }
  const id = randomUUID()
  const timestamp = nowIso()
  db.prepare(`
    INSERT INTO credit_rules
      (id, operation, provider, model_id, credits, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, operation, provider, modelId, credits, body.enabled === false ? 0 : 1, timestamp, timestamp)
  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.credit_rules.create',
    targetType: 'credit_rule',
    targetId: id,
    metadata: { operation, provider, modelId, credits }
  })
  return { success: true, data: { id } }
})
