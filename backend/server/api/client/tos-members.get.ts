import { getDb } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler((event) => {
  requireAdmin(event)

  const members = getDb()
    .prepare(`
      SELECT id, account, display_name, status
      FROM users
      WHERE role = 'user'
      ORDER BY display_name COLLATE NOCASE ASC, account COLLATE NOCASE ASC
    `)
    .all() as Array<{
      id: string
      account: string
      display_name: string
      status: string
    }>

  return {
    success: true,
    data: {
      members: members.map(member => ({
        id: member.id,
        account: member.account,
        displayName: member.display_name || member.account,
        status: member.status
      }))
    }
  }
})
