import { describe, expect, it } from 'vitest'
import {
  durationBarPercent,
  durationExactLabel,
  durationLevel,
  formatDurationMs
} from './duration'

describe('duration display helpers', () => {
  it('converts milliseconds into readable units', () => {
    expect(formatDurationMs(320)).toBe('320 ms')
    expect(formatDurationMs(1_250)).toBe('1.25 s')
    expect(formatDurationMs(12_500)).toBe('12.5 s')
    expect(formatDurationMs(125_000)).toBe('2 min 5 s')
    expect(formatDurationMs(3_725_000)).toBe('1 h 2 min')
  })

  it('handles missing and invalid durations', () => {
    expect(formatDurationMs(undefined)).toBe('-')
    expect(formatDurationMs(-1)).toBe('-')
    expect(durationExactLabel(Number.NaN)).toBe('无耗时数据')
  })

  it('uses different thresholds for HTTP and model calls', () => {
    expect(durationLevel(2_000, 'http')).toBe('warning')
    expect(durationLevel(2_000, 'model')).toBe('normal')
    expect(durationLevel(60_000, 'model')).toBe('critical')
    expect(durationBarPercent(1_500, 'http')).toBe(50)
    expect(durationBarPercent(90_000, 'model')).toBe(100)
  })
})
