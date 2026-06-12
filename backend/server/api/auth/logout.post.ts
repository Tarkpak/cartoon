import { revokeSession, requireAuth } from '../../utils/auth'
import { writeAudit } from '../../utils/audit'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  revokeSession(event)
  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'auth.logout',
    targetType: 'user',
    targetId: auth.user.id
  })
  return { success: true }
})

