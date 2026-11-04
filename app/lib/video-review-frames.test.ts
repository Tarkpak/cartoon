import { describe, expect, it } from 'vitest'
import { evaluateVideoReviewMetadata } from './video-review-frames'

describe('evaluateVideoReviewMetadata', () => {
  it('accepts a matching shot', () => {
    expect(evaluateVideoReviewMetadata({ actualDuration: 8.5, dimensions: '1920x1080' }, 8, '16:9')).toEqual([])
  })

  it('flags duration and aspect mismatches', () => {
    const issues = evaluateVideoReviewMetadata({ actualDuration: 4, dimensions: '1080x1920' }, 8, '16:9')
    expect(issues).toHaveLength(2)
    expect(issues.map(issue => issue.reason).join(' ')).toContain('画幅')
  })
})
