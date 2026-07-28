import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { getDb, jsonText, nowIso } from './db'

export interface CreditAccountSummary {
  balance: number
  totalAdded: number
  totalConsumed: number
  transactionCount: number
}

export interface ResolvedCreditCharge {
  credits: number
  metadata: Record<string, unknown>
}

export interface SeedanceCreditBreakdown {
  model_id: string
  variant: string
  resolution: string
  rate_per_second: number
  call_count: number
  duration_seconds: number
  credits_consumed: number
}

const SEEDANCE_CREDITS_PER_SECOND = {
  standard: {
    '480p': 0.462,
    '720p': 0.994,
    '1080p': 2.479,
    '4k': 5.054
  },
  fast: {
    '480p': 0.372,
    '720p': 0.799
  },
  mini: {
    '480p': 0.231,
    '720p': 0.497
  }
} as const

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function seedanceVariant(modelId: string): keyof typeof SEEDANCE_CREDITS_PER_SECOND | null {
  const normalized = modelId.trim().toLowerCase().replace(/[._]/g, '-')
  if (!normalized.includes('seedance-2-0')) return null
  if (normalized.includes('mini')) return 'mini'
  if (normalized.includes('fast')) return 'fast'
  return 'standard'
}

function normalizeResolution(value: unknown) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().toLowerCase()
  return normalized === '2160p' ? '4k' : normalized
}

function requestHasVideoInput(request: Record<string, unknown>) {
  const billing = recordValue(request.billing)
  if (request.videoUrl || request.video_url || request.firstClip || request.first_clip) return true
  const content = Array.isArray(request.content) ? request.content : []
  const contentHasVideo = content.some((item) => {
    const entry = recordValue(item)
    return entry?.type === 'video_url' || entry?.video_url !== undefined
  })
  return contentHasVideo || billing?.hasVideoInput === true
}

export function resolveSeedanceCreditCharge(modelId: string, requestValue: unknown): ResolvedCreditCharge | null {
  const variant = seedanceVariant(modelId)
  const request = recordValue(requestValue)
  if (!variant || !request || requestHasVideoInput(request)) return null

  const billing = recordValue(request.billing)
  const durationSeconds = Number(billing?.durationSeconds ?? request.duration)
  const resolution = normalizeResolution(billing?.resolution ?? request.resolution)
  const rates = SEEDANCE_CREDITS_PER_SECOND[variant] as Partial<Record<string, number>>
  const ratePerSecond = rates[resolution]
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || ratePerSecond === undefined) return null

  const credits = Math.round(durationSeconds * ratePerSecond * 1000) / 1000
  return {
    credits,
    metadata: {
      source: 'seedance_resolution_duration_rate',
      variant,
      resolution,
      durationSeconds,
      ratePerSecond,
      hasVideoInput: false
    }
  }
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

export function getSeedanceCreditBreakdown(startAt: string): SeedanceCreditBreakdown[] {
  return getDb().prepare(`
    SELECT
      model_id,
      json_extract(metadata_json, '$.variant') AS variant,
      json_extract(metadata_json, '$.resolution') AS resolution,
      json_extract(metadata_json, '$.ratePerSecond') AS rate_per_second,
      COUNT(*) AS call_count,
      ROUND(COALESCE(SUM(json_extract(metadata_json, '$.durationSeconds')), 0), 3) AS duration_seconds,
      ROUND(COALESCE(SUM(-amount), 0), 3) AS credits_consumed
    FROM credit_transactions
    WHERE type = 'model_call'
      AND created_at >= ?
      AND json_valid(metadata_json)
      AND json_extract(metadata_json, '$.source') = 'seedance_resolution_duration_rate'
    GROUP BY model_id, variant, resolution, rate_per_second
    ORDER BY credits_consumed DESC, model_id, resolution
  `).all(startAt) as SeedanceCreditBreakdown[]
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
  request?: unknown
}) {
  const db = getDb()
  const existing = db.prepare(`
    SELECT amount FROM credit_transactions WHERE model_call_log_id = ? LIMIT 1
  `).get(input.logId) as { amount: number } | undefined
  if (existing) return Math.abs(existing.amount)

  const dynamicCharge = input.operation === 'generateVideo'
    ? resolveSeedanceCreditCharge(input.modelId, input.request)
    : null
  const credits = dynamicCharge?.credits
    ?? resolveCreditCharge(input.operation, input.provider, input.modelId)
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
    jsonText(dynamicCharge?.metadata ?? { source: 'model_call_log' }),
    timestamp
  )
  db.prepare('UPDATE model_call_logs SET credits_charged = ? WHERE id = ?').run(credits, input.logId)
  return credits
}

export function assertUserExists(userId: string) {
  const row = getDb().prepare('SELECT id FROM users WHERE id = ? LIMIT 1').get(userId)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'User not found' })
}
