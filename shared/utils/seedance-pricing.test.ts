import { describe, it, expect } from 'vitest'
import cases from '../seedance-pricing-cases.json'
import { estimateSeedance, priceSeedanceRecord } from './seedance-pricing'
import { logUsageCost, logUsageTokens } from './model-usage-display'

describe('Seedance official pricing', () => {
  for (const [index, entry] of cases.entries()) {
    it(`prices case ${index + 1} ${entry.model}`, () => {
      expect(estimateSeedance(entry.model, entry)?.costNanoCny ?? null).toBe(entry.expected)
    })
  }
  it('preserves historical prices and shows native currency and billing tokens', () => {
    const record = { provider: 'volcengine', operation: 'generateVideo', model: cases[0].model, usage: { ...cases[0], costNanoCny: 42 } }
    expect(priceSeedanceRecord(record)).toBe(record)
    expect(logUsageCost({ currency: 'CNY', costNanoCny: 5009400000, costNanoUsd: null })).toBe('¥5.0094')
    expect(logUsageTokens({ videoStatus: 'succeeded', outputTokens: 108900 })).toBe('视频计费 token 108,900')
    expect(logUsageCost({ currency: 'CNY', costNanoCny: 0 })).toBe('¥0.00')
    expect(logUsageCost({ currency: 'CNY' })).toBe('未估价')
  })
})
