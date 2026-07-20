import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { creditDateBounds, shanghaiDateString } from '../../../utils/credits'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const account = db.prepare(`
    SELECT COALESCE(SUM(balance), 0) AS total_balance,
           COALESCE(SUM(total_added), 0) AS total_added,
           COALESCE(SUM(total_consumed), 0) AS total_consumed
    FROM credit_accounts
  `).get() as { total_balance: number, total_added: number, total_consumed: number }
  const today = shanghaiDateString()
  const monthStart = `${today.slice(0, 7)}-01`
  const todayStart = creditDateBounds(today, '').startAt
  const monthStartAt = creditDateBounds(monthStart, '').startAt
  const usage = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN created_at >= ? THEN -amount ELSE 0 END), 0) AS today_consumed,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN -amount ELSE 0 END), 0) AS month_consumed
    FROM credit_transactions
    WHERE type = 'model_call'
  `).get(
    todayStart,
    monthStartAt
  ) as { today_consumed: number, month_consumed: number }
  return { success: true, data: { ...account, ...usage } }
})
