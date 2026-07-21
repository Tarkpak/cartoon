import { describe, expect, it } from 'vitest'
import {
  isSceneLikelyMultiView,
  mergeEnvironmentReferenceViewImages,
  resolveEnvironmentCaptureModeForScene,
  resolveEnvironmentReferenceImageByCaptureMode,
  resolveEnvironmentReferenceImageForScene,
  resolveEnvironmentViewImageForCard
} from './asset-workbench-environment-views'

describe('asset-workbench environment views', () => {
  it('treats timeline descriptions with multiple shot segments as multi-view', () => {
    expect(isSceneLikelyMultiView({
      description: '0-3秒：中景，角色推门进入。\\n3-6秒：特写，手部拧门把。'
    })).toBe(true)
  })

  it('treats explicit multi-view hints as multi-view', () => {
    expect(isSceneLikelyMultiView({
      description: '多视角切换展示主角和反派的对峙。'
    })).toBe(true)
  })

  it('keeps single-shot descriptions as single-view', () => {
    expect(isSceneLikelyMultiView({
      description: '0-6秒：中景，固定机位，角色站在走廊尽头。'
    })).toBe(false)
  })

  it('resolves capture mode per scene with fallback', () => {
    expect(resolveEnvironmentCaptureModeForScene({
      description: '0-3秒：中景。\\n3-6秒：特写。'
    })).toBe('四视角')

    expect(resolveEnvironmentCaptureModeForScene({
      description: '0-6秒：中景，固定机位。'
    })).toBe('单视角')

    expect(resolveEnvironmentCaptureModeForScene(
      { description: '0-6秒：中景，固定机位。' },
      { fallbackCaptureMode: '四视角' }
    )).toBe('四视角')
  })

  it('prefers model tag when environmentCaptureMode is provided', () => {
    expect(resolveEnvironmentCaptureModeForScene({
      description: '0-6秒：中景，固定机位。',
      environmentCaptureMode: '四视角'
    })).toBe('四视角')

    expect(resolveEnvironmentCaptureModeForScene({
      description: '0-3秒：中景。\\n3-6秒：特写。',
      environmentCaptureMode: '单视角'
    })).toBe('单视角')
  })

  it('resolves reference image by capture mode with graceful fallback', () => {
    expect(resolveEnvironmentReferenceImageByCaptureMode({
      singleViewImage: 'single.png',
      fourViewImage: 'four.png'
    }, '单视角')).toBe('single.png')

    expect(resolveEnvironmentReferenceImageByCaptureMode({
      singleViewImage: 'single.png',
      fourViewImage: 'four.png'
    }, '四视角')).toBe('four.png')

    expect(resolveEnvironmentReferenceImageByCaptureMode({
      singleViewImage: 'single.png'
    }, '四视角')).toBe('single.png')
  })

  it('does not show panorama source as single or four-view card image', () => {
    const asset = {
      referenceImage: 'panorama.png',
      panoramaImage: 'panorama.png'
    }

    expect(resolveEnvironmentViewImageForCard(asset, '单视角')).toBeUndefined()
    expect(resolveEnvironmentViewImageForCard(asset, '四视角')).toBeUndefined()
  })

  it('ignores panorama-polluted typed and legacy history for card view images', () => {
    const asset = {
      referenceImage: 'panorama.png',
      panoramaImage: 'panorama.png',
      assetHistory: [
        {
          id: 'hist_single',
          image: 'panorama.png',
          viewMode: '单视角' as const
        },
        {
          id: 'hist_four',
          image: 'panorama.png',
          viewMode: '四视角' as const
        },
        {
          id: 'hist_legacy',
          image: 'panorama.png'
        }
      ]
    }

    expect(resolveEnvironmentViewImageForCard(asset, '单视角')).toBeUndefined()
    expect(resolveEnvironmentViewImageForCard(asset, '四视角')).toBeUndefined()
  })

  it('resolves explicit single and four-view card images before reference fallback', () => {
    const asset = {
      referenceImage: 'panorama.png',
      panoramaImage: 'panorama.png',
      singleViewImage: 'single.png',
      fourViewImage: 'four.png'
    }

    expect(resolveEnvironmentViewImageForCard(asset, '单视角')).toBe('single.png')
    expect(resolveEnvironmentViewImageForCard(asset, '四视角')).toBe('four.png')
  })

  it('does not use legacy reference images for four-view card image', () => {
    const asset = {
      referenceImage: 'single-reference.png',
      assetHistory: [
        {
          id: 'hist_legacy',
          image: 'single-reference.png'
        }
      ]
    }

    expect(resolveEnvironmentViewImageForCard(asset, '单视角')).toBe('single-reference.png')
    expect(resolveEnvironmentViewImageForCard(asset, '四视角')).toBeUndefined()
  })

  it('prefers four-view image for multi-view scenes', () => {
    expect(resolveEnvironmentReferenceImageForScene(
      {
        description: '0-3秒：中景。\\n3-6秒：特写。'
      },
      {
        singleViewImage: 'single.png',
        fourViewImage: 'four.png'
      }
    )).toBe('four.png')
  })

  it('only updates single-view image when captureMode is single', () => {
    expect(mergeEnvironmentReferenceViewImages({
      previousSingleViewImage: 'old-single.png',
      previousFourViewImage: 'old-four.png',
      nextSingleViewImage: 'new-single.png',
      nextFourViewImage: 'new-four.png',
      captureMode: '单视角'
    })).toEqual({
      singleViewImage: 'new-single.png',
      fourViewImage: 'old-four.png'
    })
  })

  it('only updates four-view image when captureMode is four_view', () => {
    expect(mergeEnvironmentReferenceViewImages({
      previousSingleViewImage: 'old-single.png',
      previousFourViewImage: 'old-four.png',
      nextSingleViewImage: 'new-single.png',
      nextFourViewImage: 'new-four.png',
      captureMode: '四视角'
    })).toEqual({
      singleViewImage: 'old-single.png',
      fourViewImage: 'new-four.png'
    })
  })

  it('seeds missing opposite mode image from current crop result without overriding existing one', () => {
    expect(mergeEnvironmentReferenceViewImages({
      previousSingleViewImage: '',
      previousFourViewImage: 'old-four.png',
      nextSingleViewImage: 'new-single.png',
      nextFourViewImage: 'new-four.png',
      captureMode: '四视角'
    })).toEqual({
      singleViewImage: 'new-single.png',
      fourViewImage: 'new-four.png'
    })

    expect(mergeEnvironmentReferenceViewImages({
      previousSingleViewImage: 'old-single.png',
      previousFourViewImage: '',
      nextSingleViewImage: 'new-single.png',
      nextFourViewImage: 'new-four.png',
      captureMode: '单视角'
    })).toEqual({
      singleViewImage: 'new-single.png',
      fourViewImage: 'new-four.png'
    })
  })
})
