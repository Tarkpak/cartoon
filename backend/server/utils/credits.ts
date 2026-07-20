import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { getDb, jsonText, nowIso } from './db'

export interface CreditAccountSummary {
  balance: number
  totalAdded: number
  totalConsumed: number
  transactionCount: number
}

export function creditDateBounds(startDate: string, endDate: string) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  const parseDate = (value: string) => {
    if (!datePattern.test(value)) return null
    const parsed = new Date(`${value}T00:00:00+08:00`)
    if (Number.isNaN(parsed.getTime())) return null
    const [year, month, day] = value.split('-').map(Number)
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(parsed)
    const actual = Object.fromEntries(parts.map(part => [part.type, part.value]))
    if (Number(actual.year) !== year || Number(actual.month) !== month || Number(actual.day) !== day) return null
    return parsed
  }
  const start = parseDate(startDate)
  const startAt = start?.toISOString() || ''
  let endAt = ''
  const end = parseDate(endDate)
  if (end) {
    const endExclusive = new Date(end)
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
    endAt = endExclusive.toISOString()
  }
  return { startAt, endAt }
}

export function shanghaiDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

export function isBillableModelCallStatus(status: string) {
  return status === 'success'
}

function ensureAccount(userId: string) {
  const db = getDb()
  db.prepare(`
    INSERT OR IGNORE INTO credit_accounts
      (user_id, balance, total_added, total_consumed, updated_at)
    VALUES (?, 0, 0, 0, ?)
  `).run(userId, nowIso())
}

export function getCreditAccount(userId: string): CreditAccountSummary {
  ensureAccount(userId)
  const db = getDb()
  const account = db.prepare(`
    SELECT balance, total_added, total_consumed
    FROM credit_accounts WHERE user_id = ?
  `).get(userId) as { balance: number, total_added: number, total_consumed: number }
  const count = db.prepare(`
    SELECT COUNT(*) AS count FROM credit_transactions WHERE user_id = ?
  `).get(userId) as { count: number }
  return {
    balance: account.balance,
    totalAdded: account.total_added,
    totalConsumed: account.total_consumed,
    transactionCount: count.count
  }
}

export function adjustUserCredits(input: {
  userId: string
  amount: number
  reason: string
  actorUserId: string
  metadata?: unknown
}) {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) {
    throw createError({ statusCode: 400, statusMessage: '积分变动必须是非零整数' })
  }
  if (Math.abs(input.amount) > 1_000_000_000) {
    throw createError({ statusCode: 400, statusMessage: '单次积分变动不能超过 10 亿' })
  }

  const db = getDb()
  return db.transaction(() => {
    ensureAccount(input.userId)
    const timestamp = nowIso()
    db.prepare(`
      UPDATE credit_accounts SET
        balance = balance + ?,
        total_added = total_added + ?,
        updated_at = ?
      WHERE user_id = ?
    `).run(input.amount, Math.max(0, input.amount), timestamp, input.userId)
    const account = getCreditAccount(input.userId)
    db.prepare(`
      INSERT INTO credit_transactions
        (id, user_id, type, amount, balance_after, reason, actor_user_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.userId,
      input.amount > 0 ? 'admin_add' : 'admin_deduct',
      input.amount,
      account.balance,
      input.reason,
      input.actorUserId,
      input.metadata === undefined ? null : jsonText(input.metadata),
      timestamp
    )
    return getCreditAccount(input.userId)
  })()
}

export function resolveCreditCharge(operation: string, provider: string, modelId: string): number {
  const row = getDb().prepare(`
    SELECT credits, enabled FROM credit_rules
    WHERE (operation = ? OR operation = '*')
      AND (provider = ? OR provider = '')
      AND (model_id = ? OR model_id = '')
    ORDER BY
      (operation = ?) DESC,
      (provider = ?) DESC,
      (model_id = ?) DESC
    LIMIT 1
  `).get(operation, provider, modelId, operation, provider, modelId) as { credits: number, enabled: number } | undefined
  if (!row?.enabled) return 0
  return Math.max(0, Math.floor(Number(row?.credits || 0)))
}

export function chargeModelCall(input: {
  userId: string
  logId: string
  operation: string
  provider: string
  modelId: string
}) {
  const db = getDb()
  const existing = db.prepare(`
    SELECT amount FROM credit_transactions WHERE model_call_log_id = ? LIMIT 1
  `).get(input.logId) as { amount: number } | undefined
  if (existing) return Math.abs(existing.amount)

  const credits = resolveCreditCharge(input.operation, input.provider, input.modelId)
  if (credits <= 0) return 0

  ensureAccount(input.userId)
  const timestamp = nowIso()
  db.prepare(`
    UPDATE credit_accounts SET
      balance = balance - ?,
      total_consumed = total_consumed + ?,
      updated_at = ?
    WHERE user_id = ?
  `).run(credits, credits, timestamp, input.userId)
  const account = getCreditAccount(input.userId)
  db.prepare(`
    INSERT INTO credit_transactions
      (id, user_id, type, amount, balance_after, reason, operation, provider, model_id,
       model_call_log_id, metadata_json, created_at)
    VALUES (?, ?, 'model_call', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    input.userId,
    -credits,
    account.balance,
    `${input.operation} 调用`,
    input.operation,
    input.provider,
    input.modelId,
    input.logId,
    jsonText({ source: 'model_call_log' }),
    timestamp
  )
  db.prepare('UPDATE model_call_logs SET credits_charged = ? WHERE id = ?').run(credits, input.logId)
  return credits
}

export function assertUserExists(userId: string) {
  const row = getDb().prepare('SELECT id FROM users WHERE id = ? LIMIT 1').get(userId)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'User not found' })
}
