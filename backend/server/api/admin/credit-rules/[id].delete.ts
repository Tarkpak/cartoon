import { createError } from 'h3'
import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { requiredParam } from '../../../utils/http'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler((event) => {
  const auth = requireAdmin(event)
  const id = requiredParam(event, 'id')
  if (id.startsWith('credit_rule_')) {
    throw createError({ statusCode: 400, statusMessage: '默认积分规则不能删除，可将其停用' })
  }
  const result = getDb().prepare('DELETE FROM credit_rules WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: '积分规则不存在' })
  }
  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.credit_rules.delete',
    targetType: 'credit_rule',
    targetId: id
  })
  return { success: true }
})
