import { getDb, nowIso } from '../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'

interface RuleInput {
  id?: string
  credits?: number
  enabled?: boolean
}

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const body = await readJsonBody<{ rules?: RuleInput[] }>(event)
  if (!Array.isArray(body.rules)) {
    throw createError({ statusCode: 400, statusMessage: 'rules is required' })
  }
  const db = getDb()
  const update = db.prepare(`
    UPDATE credit_rules SET credits = ?, enabled = ?, updated_at = ? WHERE id = ?
  `)
  db.transaction(() => {
    for (const rule of body.rules || []) {
      const credits = Number(rule.credits)
      if (!rule.id || !Number.isSafeInteger(credits) || credits < 0 || credits > 1_000_000) {
        throw createError({ statusCode: 400, statusMessage: '积分规则不合法' })
      }
      const result = update.run(credits, rule.enabled === false ? 0 : 1, nowIso(), rule.id)
      if (result.changes === 0) {
        throw createError({ statusCode: 404, statusMessage: '积分规则不存在' })
      }
    }
  })()
  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.credit_rules.update',
    targetType: 'credit_rules',
    metadata: body.rules
  })
  return { success: true }
})
