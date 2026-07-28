import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testDataDir = mkdtempSync(join(tmpdir(), 'playlet-credit-test-'))
process.env.PLAYLET_ADMIN_DATA_DIR = testDataDir

let credits: typeof import('./credits')
let dbUtils: typeof import('./db')

beforeAll(async () => {
  dbUtils = await import('./db')
  credits = await import('./credits')
  const db = dbUtils.getDb()
  const timestamp = dbUtils.nowIso()
  const insertUser = db.prepare(`
    INSERT INTO users
      (id, account, display_name, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, 'test', ?, 'active', ?, ?)
  `)
  insertUser.run('admin', 'admin', 'Admin', 'admin', timestamp, timestamp)
  insertUser.run('user', 'user', 'User', 'user', timestamp, timestamp)
})

afterAll(() => {
  dbUtils.getDb().close()
  try {
    rmSync(testDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error
  }
})

describe('credit accounting', () => {
  test('applies manual additions and deductions atomically', () => {
    credits.adjustUserCredits({
      userId: 'user',
      amount: 100,
      reason: 'initial allocation',
      actorUserId: 'admin'
    })
    const account = credits.adjustUserCredits({
      userId: 'user',
      amount: -15,
      reason: 'manual correction',
      actorUserId: 'admin'
    })

    expect(account.balance).toBe(85)
    expect(account.totalAdded).toBe(100)
    expect(account.totalConsumed).toBe(0)
    expect(account.transactionCount).toBe(2)
  })

  test('charges a successful model event once', () => {
    const db = dbUtils.getDb()
    db.prepare(`
      INSERT INTO model_call_logs
        (id, user_id, client_event_id, status, created_at)
      VALUES ('log-success', 'user', 'event-success', 'success', ?)
    `).run(dbUtils.nowIso())

    expect(credits.chargeModelCall({
      userId: 'user',
      logId: 'log-success',
      operation: 'generateImage',
      provider: 'gemini',
      modelId: 'image-model'
    })).toBe(10)
    expect(credits.chargeModelCall({
      userId: 'user',
      logId: 'log-success',
      operation: 'generateImage',
      provider: 'gemini',
      modelId: 'image-model'
    })).toBe(10)

    expect(credits.getCreditAccount('user').balance).toBe(75)
    const count = db.prepare(`
      SELECT COUNT(*) AS count FROM credit_transactions WHERE model_call_log_id = 'log-success'
    `).get() as { count: number }
    expect(count.count).toBe(1)
  })

  test('does not charge failed model events', () => {
    const db = dbUtils.getDb()
    db.prepare(`
      INSERT INTO model_call_logs
        (id, user_id, client_event_id, status, created_at)
      VALUES ('log-failed', 'user', 'event-failed', 'failed', ?)
    `).run(dbUtils.nowIso())

    expect(credits.isBillableModelCallStatus('failed')).toBe(false)
    expect(credits.isBillableModelCallStatus('pending')).toBe(false)
    expect(credits.isBillableModelCallStatus('success')).toBe(true)
    expect(credits.getCreditAccount('user').balance).toBe(75)
  })

  test('charges Seedance by output duration and resolution without video input', () => {
    const db = dbUtils.getDb()
    const timestamp = dbUtils.nowIso()
    db.prepare(`
      INSERT INTO users
        (id, account, display_name, password_hash, role, status, created_at, updated_at)
      VALUES ('seedance-user', 'seedance-user', 'Seedance User', 'test', 'user', 'active', ?, ?)
    `).run(timestamp, timestamp)
    credits.adjustUserCredits({
      userId: 'seedance-user',
      amount: 100,
      reason: 'Seedance test allocation',
      actorUserId: 'admin'
    })
    db.prepare(`
      INSERT INTO model_call_logs
        (id, user_id, client_event_id, status, created_at)
      VALUES ('log-seedance', 'seedance-user', 'event-seedance', 'success', ?)
    `).run(timestamp)

    const standard = credits.resolveSeedanceCreditCharge('doubao-seedance-2-0-260128', {
      duration: 5,
      resolution: '720p',
      content: [{ type: 'text', text: 'prompt' }]
    })
    const fast = credits.resolveSeedanceCreditCharge('doubao-seedance-2-0-fast-260128', {
      billing: { durationSeconds: 10, resolution: '480p', hasVideoInput: false }
    })
    const mini = credits.resolveSeedanceCreditCharge('doubao-seedance-2-0-mini-260615', {
      duration: 4,
      resolution: '720P'
    })
    const standard4k = credits.resolveSeedanceCreditCharge('doubao-seedance-2-0-260128', {
      duration: 4,
      resolution: '4K'
    })

    expect(standard?.credits).toBe(4.97)
    expect(standard?.metadata).toMatchObject({
      variant: 'standard',
      resolution: '720p',
      durationSeconds: 5,
      ratePerSecond: 0.994,
      hasVideoInput: false
    })
    expect(fast?.credits).toBe(3.72)
    expect(mini?.credits).toBe(1.988)
    expect(standard4k?.credits).toBe(20.216)

    expect(credits.chargeModelCall({
      userId: 'seedance-user',
      logId: 'log-seedance',
      operation: 'generateVideo',
      provider: 'volcengine',
      modelId: 'doubao-seedance-2-0-260128',
      request: { billing: { durationSeconds: 5, resolution: '720p', hasVideoInput: false } }
    })).toBe(4.97)
    expect(credits.getCreditAccount('seedance-user').balance).toBeCloseTo(95.03)
    const transaction = db.prepare(`
      SELECT amount, metadata_json FROM credit_transactions WHERE model_call_log_id = 'log-seedance'
    `).get() as { amount: number, metadata_json: string }
    expect(transaction.amount).toBeCloseTo(-4.97)
    expect(JSON.parse(transaction.metadata_json)).toMatchObject({
      source: 'seedance_resolution_duration_rate',
      ratePerSecond: 0.994,
      durationSeconds: 5
    })
    expect(credits.getSeedanceCreditBreakdown('2000-01-01T00:00:00.000Z')).toContainEqual({
      model_id: 'doubao-seedance-2-0-260128',
      variant: 'standard',
      resolution: '720p',
      rate_per_second: 0.994,
      call_count: 1,
      duration_seconds: 5,
      credits_consumed: 4.97
    })
  })

  test('does not apply Seedance no-video rates to video input or unsupported resolutions', () => {
    expect(credits.resolveSeedanceCreditCharge('doubao-seedance-2-0-260128', {
      duration: 5,
      resolution: '720p',
      billing: { hasVideoInput: false },
      content: [{ type: 'video_url', video_url: { url: 'https://example.com/input.mp4' } }]
    })).toBeNull()
    expect(credits.resolveSeedanceCreditCharge('doubao-seedance-2-0-mini-260615', {
      duration: 5,
      resolution: '1080p'
    })).toBeNull()
  })

  test('rejects a duplicate client event id before it can be billed twice', () => {
    const db = dbUtils.getDb()
    const insert = db.prepare(`
      INSERT OR IGNORE INTO model_call_logs
        (id, user_id, client_event_id, status, created_at)
      VALUES (?, 'user', 'same-event', 'success', ?)
    `)
    expect(insert.run('duplicate-a', dbUtils.nowIso()).changes).toBe(1)
    expect(insert.run('duplicate-b', dbUtils.nowIso()).changes).toBe(0)
  })

  test('uses the most specific enabled rule and lets a disabled rule suppress fallback', () => {
    const db = dbUtils.getDb()
    const timestamp = dbUtils.nowIso()
    db.prepare(`
      INSERT INTO credit_rules
        (id, operation, provider, model_id, credits, enabled, created_at, updated_at)
      VALUES
        ('provider-rule', 'generateImage', 'gemini', '', 7, 1, ?, ?),
        ('model-rule', 'generateImage', 'gemini', 'special', 3, 1, ?, ?),
        ('disabled-rule', 'generateVideo', 'kling', 'free-model', 99, 0, ?, ?)
    `).run(timestamp, timestamp, timestamp, timestamp, timestamp, timestamp)

    expect(credits.resolveCreditCharge('generateImage', 'gemini', 'special')).toBe(3)
    expect(credits.resolveCreditCharge('generateImage', 'gemini', 'other')).toBe(7)
    expect(credits.resolveCreditCharge('generateVideo', 'kling', 'free-model')).toBe(0)
    expect(credits.resolveCreditCharge('unknown', 'unknown', 'unknown')).toBe(1)
  })
})

describe('credit date handling', () => {
  test('uses inclusive Shanghai calendar dates with an exclusive end bound', () => {
    expect(credits.creditDateBounds('2026-07-21', '2026-07-21')).toEqual({
      startAt: '2026-07-20T16:00:00.000Z',
      endAt: '2026-07-21T16:00:00.000Z'
    })
  })

  test('rejects malformed calendar date inputs', () => {
    expect(credits.creditDateBounds('2026-99-99', '2026-02-30')).toEqual({
      startAt: '',
      endAt: ''
    })
  })
})
