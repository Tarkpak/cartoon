import { describe, expect, it } from 'vitest'
import cases from '../qwen-deepseek-pricing-cases.json'
import { estimateQwenDeepSeek, priceQwenDeepSeekRecord } from './qwen-deepseek-pricing'
import { logUsageTokens } from './model-usage-display'

describe('Qwen / DeepSeek official reference pricing', () => {
  for (const [index, entry] of cases.entries()) {
    it(`shared fixture ${index}: ${entry.model}`, () => {
      expect(estimateQwenDeepSeek(entry.provider, entry.model, entry.operation, entry)?.cost ?? null).toBe(entry.expected)
    })
  }
  it('preserves historical costs and snapshots', () => {
    const record = { provider: 'deepseek', model: 'deepseek-flash', operation: 'generateText', usage: { ...cases[0], costNanoUsd: 1, priceSnapshot: { version: 'old' } } }
    expect(priceQwenDeepSeekRecord(record)).toBe(record)
  })
  it('fills a missing official estimate without changing usage', () => {
    const record = { provider: 'qwen', model: 'qwen3.7-plus', operation: 'generateText', usage: { ...cases[0] } }
    const priced = priceQwenDeepSeekRecord(record)
    expect(priced.usage).toMatchObject({ costNanoCny: 2800000, currency: 'CNY', pricingStatus: 'priced', inputTokens: 1000 })
  })
  it('shows native media units without inventing tokens', () => {
    expect(logUsageTokens({ billingUnit: 'images', inputImages: 1, outputImages: 2 })).toBe('图片输入 1 / 输出 2 张')
    expect(logUsageTokens({ billingUnit: 'seconds', inputVideoSeconds: 3, durationSeconds: 10, videoStatus: 'SUCCEEDED' })).toBe('视频输入 3 / 输出 10 秒')
    expect(logUsageTokens({ billingUnit: 'characters' })).toBe('语音合成 未知 字符')
  })
})
