import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { queryAdminModelUsage } from './admin-model-usage'
import { ensureModelUsageSchema, saveModelUsage } from './model-usage'

function fixture() {
  const db = new Database(':memory:')
  ensureModelUsageSchema(db)
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,account TEXT,display_name TEXT); INSERT INTO users VALUES('a','alice','Alice'),('b','bob','Bob')")
  const add = (id: string, owner: string, date: string, cost: number | null, instance = 'proxy:a') => {
    saveModelUsage(db, owner, id, { id, createdAt: date, projectId: 'project', provider: 'custom_openai', providerInstanceId: instance, providerInstanceName: instance, model: 'requested', usage: { model: 'actual', usageStatus: cost == null ? 'unknown' : 'reported', inputTokens: cost == null ? null : 10, outputTokens: cost == null ? null : 2, costNanoUsd: cost } })
  }
  add('before', 'a', '2026-11-04T15:59:59Z', 999)
  add('start', 'a', '2026-11-04T16:00:00Z', 100)
  add('end', 'a', '2026-11-05T23:59:59+08:00', null)
  add('after', 'a', '2026-11-05T16:00:00Z', 999)
  add('other', 'b', '2026-11-05T10:00:00Z', 200, 'proxy:b')
  return db
}

describe('admin usage analytics', () => {
  it('includes Qwen media units and DeepSeek usage in provider-filtered admin totals', () => {
    const db = fixture()
    try {
      saveModelUsage(db, 'a', 'qwen', { id: 'qwen', createdAt: '2026-11-05T00:00:00Z', provider: 'qwen', model: 'wan3.0-video', operation: 'generateVideo', usage: { usageStatus: 'reported', billingUnit: 'seconds', durationSeconds: 10, inputVideoSeconds: 3, videoStatus: 'SUCCEEDED', resolution: '720P', pricingRegion: 'cn-beijing' } })
      saveModelUsage(db, 'b', 'deepseek', { id: 'deepseek', createdAt: '2026-11-05T00:00:00Z', provider: 'deepseek', model: 'deepseek-flash', operation: 'generateText', usage: { usageStatus: 'reported', inputTokens: 1000, outputTokens: 100, cachedTokens: 0 } })
      const qwen = queryAdminModelUsage(db, { provider: 'qwen', currency: 'CNY' })
      expect(qwen.total).toMatchObject({ calls: 1, costNanoCny: 7800000000, inputTokens: 0, outputTokens: 0 })
      expect(qwen.records[0]).toMatchObject({ billingUnit: 'seconds', durationSeconds: 10, inputVideoSeconds: 3 })
      const ds = queryAdminModelUsage(db, { provider: 'deepseek', currency: 'USD' })
      expect(ds.total).toMatchObject({ calls: 1, costNanoUsd: 420000, inputTokens: 1000, outputTokens: 100 })
      expect(ds.records[0].userName).toBe('Bob')
    } finally { db.close() }
  })
  it('keeps CNY and USD sums separate and filters currency before ranking', () => {
    const db = fixture()
    try {
      const record = { id: 'video', createdAt: '2026-11-05T00:00:00Z', provider: 'volcengine', model: 'doubao-seedance-2-0-260128', operation: 'generateVideo', usage: { usageStatus: 'reported', videoStatus: 'succeeded', outputTokens: 108900, resolution: '720p', hasVideoInput: false } }
      saveModelUsage(db, 'a', 'video', record)
      saveModelUsage(db, 'a', 'video', record)
      const mixed = queryAdminModelUsage(db, {})
      expect(mixed.total.costNanoUsd).toBe(2298)
      expect(mixed.total.costNanoCny).toBe(5009400000)
      const cny = queryAdminModelUsage(db, { currency: 'CNY' })
      expect(cny.total.calls).toBe(1)
      expect(cny.total.costNanoUsd).toBe(0)
      expect(cny.total.pricedCnyCalls).toBe(1)
      expect(cny.records[0].currency).toBe('CNY')
      expect(cny.users[0].costNanoCny).toBe(cny.total.costNanoCny)
      expect(() => queryAdminModelUsage(db, { currency: 'invalid' })).toThrow()
    } finally { db.close() }
  })
  it('aggregates all users within Beijing dates while pagination only limits details', () => {
    const db = fixture()
    try {
      const query = { startDate: '2026-11-05', endDate: '2026-11-05', pageSize: '1' }
      const data = queryAdminModelUsage(db, query)
      expect(data.total).toEqual({ calls: 3, pricedCalls: 2, unknownCalls: 1, inputTokens: 20, outputTokens: 4, costNanoUsd: 300, costNanoCny: 0, pricedUsdCalls: 2, pricedCnyCalls: 0 })
      expect(data.records).toHaveLength(1)
      expect(data.pagination.total).toBe(3)
      expect(data.users.reduce((sum, row) => sum + row.costNanoUsd, 0)).toBe(300)
      expect(data.models).toHaveLength(2)
      expect(data.models.reduce((sum, row) => sum + row.costNanoUsd, 0)).toBe(300)
      const second = queryAdminModelUsage(db, { ...query, page: '2' })
      expect(second.total).toEqual(data.total)
      expect(second.records[0].id).not.toBe(data.records[0].id)
      expect(data.records[0]).not.toHaveProperty('record_json')
    } finally { db.close() }
  })
  it('filters by user, provider, actual model and project with parameterized values', () => {
    const db = fixture()
    try {
      const data = queryAdminModelUsage(db, { userId: 'b', provider: 'custom_openai', model: 'actual', projectId: 'project' })
      expect(data.total.calls).toBe(1)
      expect(data.records[0].userName).toBe('Bob')
      expect(queryAdminModelUsage(db, { userId: "' OR 1=1 --" }).total.calls).toBe(0)
      expect(queryAdminModelUsage(db, { model: 'requested' }).records).toHaveLength(0)
    } finally { db.close() }
  })
  it('returns a zero summary for empty filters and validates dates and pages', () => {
    const db = fixture()
    try {
      expect(queryAdminModelUsage(db, { userId: 'missing' }).total.costNanoUsd).toBe(0)
      for (const query of [{ startDate: '2026-02-30' }, { startDate: '2026-11-06', endDate: '2026-11-05' }, { page: '0' }, { pageSize: '101' }, { model: ['a', 'b'] }]) {
        expect(() => queryAdminModelUsage(db, query)).toThrow()
      }
    } finally { db.close() }
  })
})
