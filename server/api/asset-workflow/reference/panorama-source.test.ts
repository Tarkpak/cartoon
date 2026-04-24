import { describe, expect, it } from 'vitest'
import {
  PANORAMA_SOURCE_ASPECT_RATIO,
  normalizeAspectRatioValue,
  parseAspectRatioValue,
  pickClosestSupportedAspectRatio,
  resolvePanoramaSourceImageSize,
  resolvePanoramaSourceProfile
} from './panorama-source'

describe('panorama source aspect-ratio fallback', () => {
  it('keeps 21:9 when model supports 21:9', () => {
    const profile = resolvePanoramaSourceProfile({
      supportedAspectRatios: ['16:9', '21:9', '1:1']
    })

    expect(profile).toEqual({
      aspectRatio: '21:9',
      size: '2100*900',
      fallbackApplied: false
    })
  })

  it('falls back to closest supported ratio when 21:9 is unavailable', () => {
    const profile = resolvePanoramaSourceProfile({
      supportedAspectRatios: ['1:1', '16:9', '3:2']
    })

    expect(profile).toEqual({
      aspectRatio: '16:9',
      size: '1280*720',
      fallbackApplied: true
    })
  })

  it('handles invalid or empty supported ratios by using default 21:9', () => {
    expect(resolvePanoramaSourceProfile({
      supportedAspectRatios: ['auto', 'bad']
    })).toEqual({
      aspectRatio: '21:9',
      size: '2100*900',
      fallbackApplied: false
    })

    expect(resolvePanoramaSourceProfile()).toEqual({
      aspectRatio: '21:9',
      size: '2100*900',
      fallbackApplied: false
    })
  })
})

describe('panorama source helper utilities', () => {
  it('normalizes aspect-ratio values', () => {
    expect(normalizeAspectRatioValue(' 21 : 9 ')).toBe('21:9')
    expect(normalizeAspectRatioValue('0:9')).toBeNull()
    expect(normalizeAspectRatioValue('abc')).toBeNull()
  })

  it('parses ratio values', () => {
    expect(parseAspectRatioValue('21:9')).toBeCloseTo(21 / 9, 5)
    expect(parseAspectRatioValue('bad')).toBeNull()
  })

  it('selects closest ratio and resolves mapped output size', () => {
    expect(pickClosestSupportedAspectRatio(
      PANORAMA_SOURCE_ASPECT_RATIO,
      ['3:4', '9:16', '4:3']
    )).toBe('4:3')

    expect(resolvePanoramaSourceImageSize('4:3')).toBe('1152*864')
    expect(resolvePanoramaSourceImageSize('unknown')).toBe('2100*900')
  })
})
