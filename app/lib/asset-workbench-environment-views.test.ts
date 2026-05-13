import { describe, expect, it } from 'vitest'
import {
  isSceneLikelyMultiView,
  resolveEnvironmentCaptureModeForScene,
  resolveEnvironmentReferenceImageByCaptureMode,
  resolveEnvironmentReferenceImageForScene
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
    })).toBe('four_view')

    expect(resolveEnvironmentCaptureModeForScene({
      description: '0-6秒：中景，固定机位。'
    })).toBe('single')

    expect(resolveEnvironmentCaptureModeForScene(
      { description: '0-6秒：中景，固定机位。' },
      { fallbackCaptureMode: 'four_view' }
    )).toBe('four_view')
  })

  it('prefers model tag when environmentCaptureMode is provided', () => {
    expect(resolveEnvironmentCaptureModeForScene({
      description: '0-6秒：中景，固定机位。',
      environmentCaptureMode: 'four_view'
    })).toBe('four_view')

    expect(resolveEnvironmentCaptureModeForScene({
      description: '0-3秒：中景。\\n3-6秒：特写。',
      environmentCaptureMode: 'single'
    })).toBe('single')
  })

  it('resolves reference image by capture mode with graceful fallback', () => {
    expect(resolveEnvironmentReferenceImageByCaptureMode({
      singleViewImage: 'single.png',
      fourViewImage: 'four.png'
    }, 'single')).toBe('single.png')

    expect(resolveEnvironmentReferenceImageByCaptureMode({
      singleViewImage: 'single.png',
      fourViewImage: 'four.png'
    }, 'four_view')).toBe('four.png')

    expect(resolveEnvironmentReferenceImageByCaptureMode({
      singleViewImage: 'single.png'
    }, 'four_view')).toBe('single.png')
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
})
