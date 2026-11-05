import { describe, expect, it } from 'vitest'
import { usageCost, usageTokens, usageProvider, usageModelGroup, usageStage } from './model-usage'

describe('usage display', () => {
  it('distinguishes unknown, zero and sub-cent costs', () => {
    expect(usageCost(null)).toBe('暂无法估价')
    expect(usageCost(0)).toBe('$0.0000')
    expect(usageCost(1)).toBe('< $0.0001')
    expect(usageCost(16_000_000)).toBe('$0.0160')
  })
  it('does not display missing usage as zero', () => {
    expect(usageTokens(null)).toBe('未知')
    expect(usageTokens(0)).toBe('0')
    expect(usageTokens(12500)).toBe('12,500')
  })
  it('distinguishes provider instances and preserves legacy uncertainty', () => {
    expect(usageProvider('custom_openai:legacy')).toContain('历史未区分')
    expect(usageProvider('qwen:legacy')).toBe('通义千问 · 历史未区分')
    expect(usageProvider('deepseek:legacy')).toBe('DeepSeek · 历史未区分')
    expect(usageProvider('custom_openai:a:abcdef', [{ key: 'custom_openai:a:abcdef', label: '代理 A' }])).toBe('代理 A · abcdef')
    expect(usageModelGroup('["instance","same-model","generateText"]')).toEqual({ instanceId: 'instance', model: 'same-model', stage: 'generateText' })
    expect(usageModelGroup('legacy')).toEqual({ instanceId: '', model: 'legacy', stage: '' })
    expect(usageStage('generateImage')).toBe('图片生成 / 编辑')
  })
})
