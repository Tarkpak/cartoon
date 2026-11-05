import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { ensureModelUsageSchema, saveModelUsage, modelLogUsageSql } from './model-usage'

describe('usage ledger', () => {
  it('prices and syncs Qwen media and DeepSeek text without mixing currencies or units', () => {
    const db = new Database(':memory:')
    try {
      ensureModelUsageSchema(db)
      const base = { id: 'qwen-image', createdAt: '2026-11-05T00:00:00Z', provider: 'qwen', operation: 'generateImage', model: 'qwen-image-2.1-pro', usage: { usageStatus: 'reported', billingUnit: 'images', outputImages: 2, pricingRegion: 'cn-beijing' } }
      saveModelUsage(db, 'alice', base.id, base)
      saveModelUsage(db, 'alice', base.id, base)
      saveModelUsage(db, 'bob', base.id, base)
      saveModelUsage(db, 'alice', 'deepseek', { ...base, id: 'deepseek', provider: 'deepseek', model: 'deepseek-flash', operation: 'generateText', usage: { usageStatus: 'reported', inputTokens: 1000, outputTokens: 100, cachedTokens: 0 } })
      const rows = db.query('SELECT user_id,record_json FROM model_usage_records ORDER BY id,user_id').all() as Array<{ user_id: string, record_json: string }>
      expect(rows).toHaveLength(3)
      expect(JSON.parse(rows[0].record_json).usage).toMatchObject({ costNanoUsd: 420000, currency: 'USD' })
      expect(JSON.parse(rows[1].record_json).usage).toMatchObject({ outputImages: 2, billingUnit: 'images', costNanoCny: 500000000, currency: 'CNY' })
      expect(JSON.parse(rows[1].record_json).usage.inputTokens).toBeUndefined()
      expect(() => saveModelUsage(db, 'alice', base.id, { ...base, usage: { ...base.usage, outputImages: -1 } })).toThrow()
      expect(() => saveModelUsage(db, 'alice', base.id, { ...base, usage: { ...base.usage, durationSeconds: -1 } })).toThrow()
    } finally { db.close() }
  })
  it('prices OpenAI uploads, enriches old unpriced records and keeps attempt/user isolation in logs', () => {
    const db = new Database(':memory:')
    ensureModelUsageSchema(db)
    try {
      const record = { id: 'event', createdAt: '2026-11-05T00:00:00Z', provider: 'openai', model: 'gpt-5', operation: 'generateText', usage: { usageStatus: 'reported', inputTokens: 1000, cachedTokens: 200, outputTokens: 100 } }
      saveModelUsage(db, 'alice', 'event', record)
      saveModelUsage(db, 'bob', 'event', { ...record, usage: { ...record.usage, costNanoUsd: 999 } })
      db.exec("CREATE TABLE logs(user_id TEXT, client_event_id TEXT); INSERT INTO logs VALUES('alice','event'),('bob','event'),('alice','missing')")
      const rows = db.query(`SELECT ${modelLogUsageSql} AS usage FROM logs l ORDER BY rowid`).all() as Array<{ usage: string | null }>
      expect(JSON.parse(rows[0].usage!).costNanoUsd).toBe(2025000)
      expect(JSON.parse(rows[1].usage!).costNanoUsd).toBe(999)
      expect(rows[2].usage).toBeNull()
      db.query('UPDATE model_usage_records SET record_json=? WHERE user_id=?').run(JSON.stringify(record), 'alice')
      ensureModelUsageSchema(db)
      ensureModelUsageSchema(db)
      const updated = db.query('SELECT record_json FROM model_usage_records WHERE user_id=?').get('alice') as { record_json: string }
      expect(JSON.parse(updated.record_json).usage.costNanoUsd).toBe(2025000)
      const bob = db.query('SELECT record_json FROM model_usage_records WHERE user_id=?').get('bob') as { record_json: string }
      expect(JSON.parse(bob.record_json).usage.costNanoUsd).toBe(999)
    } finally { db.close() }
  })
  it('deduplicates sync and isolates users without depending on debug logs', () => {
    const db = new Database(':memory:')
    ensureModelUsageSchema(db)
    const record = { id: 'event', createdAt: '2026-11-05T00:00:00Z', usage: { usageStatus: 'unknown', costNanoUsd: null } }
    saveModelUsage(db, 'alice', 'event', record)
    saveModelUsage(db, 'alice', 'event', record)
    saveModelUsage(db, 'bob', 'event', record)
    expect(db.query('SELECT COUNT(*) AS n FROM model_usage_records').get()).toEqual({ n: 2 })
    db.close()
  })
  it('rejects mismatched identities and invalid quantities', () => {
    const db = new Database(':memory:')
    ensureModelUsageSchema(db)
    expect(() => saveModelUsage(db, 'alice', 'event', { id: 'other' })).toThrow()
    expect(() => saveModelUsage(db, 'alice', 'event', { id: 'event', createdAt: '2026-11-05', usage: { usageStatus: 'reported', inputTokens: -1 } })).toThrow()
    db.close()
  })
  it('keeps reported usage and the historical price snapshot on delayed retries', () => {
    const db = new Database(':memory:')
    ensureModelUsageSchema(db)
    const record = { id: 'event', createdAt: '2026-11-05T00:00:00Z', usage: { usageStatus: 'reported', inputTokens: 10, outputTokens: 2, costNanoUsd: 100 } }
    saveModelUsage(db, 'alice', 'event', record)
    saveModelUsage(db, 'alice', 'event', { ...record, usage: { usageStatus: 'unknown', costNanoUsd: null } })
    const row = db.query('SELECT record_json FROM model_usage_records WHERE user_id=?').get('alice') as { record_json: string }
    expect(JSON.parse(row.record_json).usage.costNanoUsd).toBe(100)
    db.close()
  })
  it('preserves instance, stage and custom price snapshots across cloud sync', () => {
    const db = new Database(':memory:')
    ensureModelUsageSchema(db)
    saveModelUsage(db, 'alice', 'event', { id: 'event', createdAt: '2026-11-05T00:00:00Z', providerInstanceId: 'custom_openai:a:host', providerInstanceName: '代理 A', stage: 'scene_detail', usage: { usageStatus: 'reported', costNanoUsd: 100, priceSnapshot: { version: 'custom-1', source: 'user-configured' } } })
    const row = db.query('SELECT record_json FROM model_usage_records').get() as { record_json: string }
    expect(JSON.parse(row.record_json)).toMatchObject({ providerInstanceId: 'custom_openai:a:host', stage: 'scene_detail', usage: { priceSnapshot: { version: 'custom-1' } } })
    db.close()
  })
})
