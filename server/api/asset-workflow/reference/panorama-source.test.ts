import { describe, expect, it } from 'vitest'
import {
  PANORAMA_SOURCE_ASPECT_RATIO,
  normalizeAspectRatioValue,
  normalizeImageSizeValue,
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
      mode: 'equirectangular_360',
      modeLabel: '360 等距柱状全景图',
      aspectRatio: '2:1',
      size: '2048*1024',
      fallbackApplied: false
    })
  })

  it('uses requested non-2:1 panorama source mode and ratio', () => {
    const profile = resolvePanoramaSourceProfile({
      supportedAspectRatios: ['1:1', '16:9', '21:9']
    }, {
      panoramaSourceMode: 'equirectangular_180'
    })

    expect(profile).toEqual({
      mode: 'equirectangular_180',
      modeLabel: '180 半球等距全景图',
      aspectRatio: '1:1',
      size: '1536*1536',
      fallbackApplied: false
    })
  })

  it('marks fallbackApplied when model does not declare requested ratio', () => {
    const profile = resolvePanoramaSourceProfile({
      supportedAspectRatios: ['1:1', '16:9', '3:2']
    }, {
      panoramaSourceMode: 'equirectangular_360'
    })

    expect(profile).toEqual({
      mode: 'equirectangular_360',
      modeLabel: '360 等距柱状全景图',
      aspectRatio: '2:1',
      size: '2048*1024',
      fallbackApplied: true
    })
  })

  it('handles custom panorama source options and normalizes size separators', () => {
    expect(resolvePanoramaSourceProfile(undefined, {
      panoramaSourceMode: 'custom',
      panoramaCustomAspectRatio: ' 3 : 2 ',
      panoramaCustomSize: '1536x1024'
    })).toEqual({
      mode: 'custom',
      modeLabel: '自定义环境源图',
      aspectRatio: '3:2',
      size: '1536*1024',
      fallbackApplied: false
    })
  })

  it('handles invalid options by using default 2:1', () => {
    expect(resolvePanoramaSourceProfile({
      supportedAspectRatios: ['auto', 'bad']
    })).toEqual({
      mode: 'equirectangular_360',
      modeLabel: '360 等距柱状全景图',
      aspectRatio: '2:1',
      size: '2048*1024',
      fallbackApplied: false
    })

    expect(resolvePanoramaSourceProfile(undefined, {
      panoramaSourceMode: 'custom',
      panoramaCustomAspectRatio: 'bad-ratio',
      panoramaCustomSize: 'bad-size'
    })).toEqual({
      mode: 'custom',
      modeLabel: '自定义环境源图',
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

  it('normalizes image size values', () => {
    expect(normalizeImageSizeValue(' 2048x1024 ')).toBe('2048*1024')
    expect(normalizeImageSizeValue('1024*1024')).toBe('1024*1024')
    expect(normalizeImageSizeValue('bad')).toBeNull()
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
