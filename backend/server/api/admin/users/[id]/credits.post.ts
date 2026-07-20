import { adjustUserCredits, assertUserExists } from '../../../../utils/credits'
import { readJsonBody, requireAdmin } from '../../../../utils/auth'
import { optionalString, requiredParam } from '../../../../utils/http'
import { writeAudit } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const userId = requiredParam(event, 'id')
  assertUserExists(userId)
  const body = await readJsonBody<{ amount?: number, reason?: string }>(event)
  const amount = Number(body.amount)
  const reason = optionalString(body.reason, 500)
  if (!reason) {
    throw createError({ statusCode: 400, statusMessage: '请填写积分调整原因' })
  }
  const account = adjustUserCredits({
    userId,
    amount,
    reason,
    actorUserId: auth.user.id
  })
  writeAudit(event, {
    actorUserId: auth.user.id,
    action: amount > 0 ? 'admin.credits.add' : 'admin.credits.deduct',
    targetType: 'user',
    targetId: userId,
    metadata: { amount, reason, balanceAfter: account.balance }
  })
  return { success: true, data: { account } }
})
