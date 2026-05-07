import { describe, expect, it } from 'vitest'
import {
  assertPanoramaSourceSize,
  assertEquirectangularPanoramaSize,
  buildDefaultCropSelection,
  isPanoramaSourceSize,
  isEquirectangularPanoramaSize,
  normalizeCropSelection,
  normalizePanoramaSelection,
  normalizePanoramaSelectionForAspectRatio,
  resolveCropSelectionAspectRatio,
  resolveCropSelectionCoverage,
  resolveCropSelectionOutputSize,
  resolveMaxCropSelection,
  resolvePanoramaOutputAspectRatioValue,
  resolvePanoramaSourceAspectRatioValue,
  resolvePanoramaOutputSize,
  resolvePanoramaSelectionHeightForAspectRatio,
  resolvePerspectiveVerticalFov
} from './asset-workbench-environment-panorama'

describe('environment panorama crop helpers', () => {
  it('builds a centered default camera viewport', () => {
    const selection = buildDefaultCropSelection({
      imageWidth: 2048,
      imageHeight: 1024
    })

    expect(selection.width).toBeCloseTo(0.22, 5)
    expect(selection.height).toBeCloseTo(0.27727, 5)
    expect(selection.x).toBeCloseTo(0.39, 5)
    expect(selection.y).toBeCloseTo(0.36136, 5)
  })

  it('validates 2:1 equirectangular panorama source dimensions', () => {
    expect(isEquirectangularPanoramaSize(2048, 1024)).toBe(true)
    expect(isEquirectangularPanoramaSize(2000, 1000)).toBe(true)
    expect(isEquirectangularPanoramaSize(1920, 1080)).toBe(false)
    expect(() => assertEquirectangularPanoramaSize(1920, 1080)).toThrow('2:1')
  })

  it('validates non-2:1 panorama source dimensions by configured ratio', () => {
    expect(isPanoramaSourceSize(1536, 1536, '1:1')).toBe(true)
    expect(isPanoramaSourceSize(1536, 1536, '2:1')).toBe(false)
    expect(isPanoramaSourceSize(1536, 1024, '3:2')).toBe(true)
    expect(resolvePanoramaSourceAspectRatioValue(' 6 : 1 ')).toBeCloseTo(6, 5)
    expect(() => assertPanoramaSourceSize(1536, 1536, '2:1')).toThrow('2:1')
  })

  it('derives vertical FOV from horizontal FOV and output aspect ratio', () => {
    const horizontalFov = 0.22 * Math.PI * 2
    const verticalFov = resolvePerspectiveVerticalFov(horizontalFov, 16 / 9)

    expect(verticalFov).toBeCloseTo(0.87108, 5)
    expect(resolvePanoramaSelectionHeightForAspectRatio(0.22, 16 / 9)).toBeCloseTo(0.27727, 5)
  })

  it('resolves project output aspect ratios for preview and export', () => {
    expect(resolvePanoramaOutputAspectRatioValue('16:9')).toBeCloseTo(16 / 9, 5)
    expect(resolvePanoramaOutputAspectRatioValue('9:16')).toBeCloseTo(9 / 16, 5)
    expect(resolvePanoramaOutputAspectRatioValue('1:1')).toBeCloseTo(1, 5)
    expect(resolvePanoramaOutputAspectRatioValue('bad')).toBeCloseTo(16 / 9, 5)

    expect(resolvePanoramaOutputSize({ aspectRatio: '16:9' })).toEqual({ width: 1920, height: 1080 })
    expect(resolvePanoramaOutputSize({ aspectRatio: '9:16' })).toEqual({ width: 1080, height: 1920 })
    expect(resolvePanoramaOutputSize({ aspectRatio: '1:1' })).toEqual({ width: 1440, height: 1440 })
  })

  it('normalizes both horizontal and vertical bounds inside the source image', () => {
    const selection = normalizeCropSelection(
      { x: 0.8, y: 1.35, width: 0.6, height: 0.9 },
      1280,
      720
    )

    expect(selection).toBeTruthy()
    expect(selection?.x).toBeGreaterThanOrEqual(0)
    expect((selection?.x || 0) + (selection?.width || 0)).toBeLessThanOrEqual(1)
    expect(selection?.y).toBeGreaterThanOrEqual(0)
    expect((selection?.y || 0) + (selection?.height || 0)).toBeLessThanOrEqual(1)
    expect(selection?.x).toBeCloseTo(0.4, 5)
    expect(selection?.y).toBeCloseTo(0.1, 5)
    expect(selection?.width).toBeCloseTo(0.6, 5)
    expect(selection?.height).toBeCloseTo(0.9, 5)
  })

  it('preserves arbitrary crop ratios inside the valid bounds', () => {
    const normalized = normalizeCropSelection(
      {
        x: 0.2,
        y: 0.15,
        width: 0.3,
        height: 0.18
      },
      2064,
      512
    )

    expect(normalized).toEqual({
      x: 0.2,
      y: 0.15,
      width: 0.3,
      height: 0.18
    })
    expect(resolveCropSelectionAspectRatio(normalized, 2064, 512)).toBeCloseTo(6.7188, 3)
  })

  it('allows panorama selections to wrap across the horizontal seam', () => {
    const normalized = normalizePanoramaSelection(
      {
        x: 0.95,
        y: 0.2,
        width: 0.2,
        height: 0.25
      },
      2048,
      1024
    )

    expect(normalized).toEqual({
      x: 0.95,
      y: 0.2,
      width: 0.2,
      height: 0.25
    })
  })

  it('normalizes panorama selection height to the target output aspect ratio', () => {
    const normalized = normalizePanoramaSelectionForAspectRatio(
      {
        x: 0.39,
        y: 0.36,
        width: 0.22,
        height: 0.27
      },
      2048,
      1024,
      '9:16'
    )

    expect(normalized).toBeTruthy()
    expect(normalized?.x).toBeCloseTo(0.39, 5)
    expect(normalized?.width).toBeCloseTo(0.22, 5)
    expect(normalized?.height).toBeCloseTo(
      resolvePanoramaSelectionHeightForAspectRatio(0.22, 9 / 16),
      5
    )
  })

  it('calculates coverage against the freeform max selection area', () => {
    const maxSelection = resolveMaxCropSelection(1280, 720)
    const coverage = resolveCropSelectionCoverage(
      {
        x: 0.2,
        y: 0.1,
        width: maxSelection.width * 0.5,
        height: maxSelection.height * 0.5
      },
      1280,
      720
    )

    expect(coverage).toBeCloseTo(0.5, 5)
  })

  it('resolves output size from the selection aspect ratio', () => {
    const size = resolveCropSelectionOutputSize({
      selection: {
        width: 0.3,
        height: 0.18
      },
      sourceWidth: 2064,
      sourceHeight: 512,
      targetPixels: 1280 * 720,
      maxDimension: 1600,
      minDimension: 480
    })

    expect(size.width / size.height).toBeCloseTo(6.7188, 2)
    expect(size.width).toBeGreaterThan(size.height)
    expect(size.width).toBeGreaterThanOrEqual(1000)
  })
})
