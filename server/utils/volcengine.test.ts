import { describe, expect, it } from 'vitest'
import { resolveVolcengineVideoAspectRatio } from './volcengine'

describe('volcengine video aspect ratio', () => {
  it('returns the configured ratio when supported', () => {
    expect(resolveVolcengineVideoAspectRatio('16:9')).toBe('16:9')
    expect(resolveVolcengineVideoAspectRatio('9:16')).toBe('9:16')
    expect(resolveVolcengineVideoAspectRatio('1:1')).toBe('1:1')
  })

  it('falls back to 16:9 when ratio is missing or unsupported', () => {
    expect(resolveVolcengineVideoAspectRatio()).toBe('16:9')
    expect(resolveVolcengineVideoAspectRatio('21:9')).toBe('16:9')
  })

  it('supports trim normalization', () => {
    expect(resolveVolcengineVideoAspectRatio(' 9:16 ')).toBe('9:16')
  })
})
