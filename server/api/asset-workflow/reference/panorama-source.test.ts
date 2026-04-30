import { describe, expect, it } from 'vitest'
import {
  PANORAMA_SOURCE_ASPECT_RATIO,
  normalizeAspectRatioValue,
  parseAspectRatioValue,
  pickClosestSupportedAspectRatio,
  resolvePanoramaSourceImageSize,
  resolvePanoramaSourceProfile
} from './panorama-source'

describe('panorama source aspect-ratio requirements', () => {
  it('keeps 2:1 when model supports standard equirectangular panorama ratio', () => {
    const profile = resolvePanoramaSourceProfile({
      supportedAspectRatios: ['16:9', '2:1', '1:1']
    })

    expect(profile).toEqual({
      aspectRatio: '2:1',
      size: '2048*1024',
      fallbackApplied: false
    })
  })

  it('keeps requesting 2:1 when only non-panorama ultra-wide ratios are declared', () => {
    const profile = resolvePanoramaSourceProfile({
      supportedAspectRatios: ['1:1', '16:9', '21:9']
    })

    expect(profile).toEqual({
      aspectRatio: '2:1',
      size: '2048*1024',
      fallbackApplied: true
    })
  })

  it('does not treat closest non-2:1 ratios as 360 panorama sources', () => {
    const profile = resolvePanoramaSourceProfile({
      supportedAspectRatios: ['1:1', '16:9', '3:2']
    })

    expect(profile).toEqual({
      aspectRatio: '2:1',
      size: '2048*1024',
      fallbackApplied: true
    })
  })

  it('handles invalid or empty supported ratios by using default 2:1', () => {
    expect(resolvePanoramaSourceProfile({
      supportedAspectRatios: ['auto', 'bad']
    })).toEqual({
      aspectRatio: '2:1',
      size: '2048*1024',
      fallbackApplied: false
    })

    expect(resolvePanoramaSourceProfile()).toEqual({
      aspectRatio: '2:1',
      size: '2048*1024',
      fallbackApplied: false
    })
  })
})

describe('panorama source helper utilities', () => {
  it('normalizes aspect-ratio values', () => {
    expect(normalizeAspectRatioValue(' 2 : 1 ')).toBe('2:1')
    expect(normalizeAspectRatioValue('0:9')).toBeNull()
    expect(normalizeAspectRatioValue('abc')).toBeNull()
  })

  it('parses ratio values', () => {
    expect(parseAspectRatioValue('2:1')).toBeCloseTo(2, 5)
    expect(parseAspectRatioValue('bad')).toBeNull()
  })

  it('selects closest ratio and resolves mapped output size', () => {
    expect(pickClosestSupportedAspectRatio(
      PANORAMA_SOURCE_ASPECT_RATIO,
      ['3:4', '9:16', '4:3']
    )).toBe('4:3')

    expect(resolvePanoramaSourceImageSize('4:3')).toBe('1152*864')
    expect(resolvePanoramaSourceImageSize('unknown')).toBe('2048*1024')
  })
})
