import { describe, expect, it } from 'vitest'
import { actionableReviewIssues, buildVideoReviewRepairInstruction } from './video-review-repair'

describe('video review repair', () => {
  it('turns actionable findings into a constrained rewrite instruction', () => {
    const instruction = buildVideoReviewRepairInstruction([{ severity: 'high', reason: '角色服装变化', suggestion: '沿用前镜头服装' }], 8)
    expect(instruction).toContain('角色服装变化')
    expect(instruction).toContain('沿用前镜头服装')
    expect(instruction).toContain('保留原剧情事件')
  })

  it('does not auto repair low severity or incomplete findings', () => {
    expect(actionableReviewIssues([{ severity: 'low', reason: '轻微偏差', suggestion: '复核' }, { severity: 'high', reason: '', suggestion: '重做' }])).toEqual([])
    expect(buildVideoReviewRepairInstruction([], 8)).toBe('')
  })
})
