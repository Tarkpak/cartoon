import { getDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/auth'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const members = getDb().prepare(`
    SELECT id, account, display_name, role
    FROM users
    WHERE status = 'active' AND id != ?
    ORDER BY display_name, account
  `).all(auth.user.id) as Array<{
    id: string
    account: string
    display_name: string
    role: string
  }>

  return {
    success: true,
    data: {
      members: members.map(member => ({
        id: member.id,
        account: member.account,
        displayName: member.display_name || member.account,
        role: member.role
      }))
    }
  }
})
