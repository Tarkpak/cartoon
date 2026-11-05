import { describe, expect, it } from 'vitest'
import cases from '../openai-pricing-cases.json'
import { estimateOpenAI, priceOpenAIRecord } from './openai-pricing'
import { logUsageCost, logUsageTokens } from './model-usage-display'

describe('official OpenAI pricing and log display', () => {
  for (const [index, entry] of cases.entries()) {
    it(`prices official case ${index + 1}: ${entry.model}`, () => {
      expect(estimateOpenAI(entry.model, entry.operation || 'generateText', entry)?.costNanoUsd ?? null).toBe(entry.expected)
    })
  }
  it('keeps existing snapshots and custom provider rules unchanged', () => {
    const record = { provider: 'openai', model: 'gpt-5', operation: 'generateText', usage: { inputTokens: 1000, outputTokens: 100, costNanoUsd: 42 } }
    expect(priceOpenAIRecord(record)).toBe(record)
    const custom = { ...record, provider: 'custom_openai', usage: { inputTokens: 1000, outputTokens: 100 } }
    expect(priceOpenAIRecord(custom)).toBe(custom)
  })
  it('shows small charges, genuine zero and unknown values distinctly', () => {
    expect(logUsageCost({ costNanoUsd: 13 })).toBe('$0.000000013')
    expect(logUsageCost({ costNanoUsd: 0 })).toBe('$0.00')
    expect(logUsageCost(null)).toBe('未估价')
    expect(logUsageTokens({ inputTokens: 0, outputTokens: null })).toBe('输入 0 / 输出 未知')
    expect(logUsageTokens(null)).toBe('未采集用量')
  })
})
