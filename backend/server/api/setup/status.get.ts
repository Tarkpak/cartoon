import { getDb } from '../../utils/db'

export default defineEventHandler(() => {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
    .get() as { count: number }

  return {
    success: true,
    data: {
      initialized: row.count > 0
    }
  }
})

