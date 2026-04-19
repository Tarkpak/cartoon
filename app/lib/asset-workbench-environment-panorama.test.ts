import { describe, expect, it } from 'vitest'
import {
  buildDefaultCropSelection,
  normalizeCropSelection,
  resolveCropSelectionAspectRatio,
  resolveCropSelectionCoverage,
  resolveCropSelectionOutputSize,
  resolveMaxCropSelection
} from './asset-workbench-environment-panorama'

describe('environment panorama crop helpers', () => {
  it('builds a centered freeform crop window', () => {
    const selection = buildDefaultCropSelection({
      imageWidth: 1280,
      imageHeight: 720
    })

    expect(selection.width).toBeCloseTo(0.22, 5)
    expect(selection.height).toBeCloseTo(0.4, 5)
    expect(selection.x).toBeCloseTo(0.39, 5)
    expect(selection.y).toBeCloseTo(0.3, 5)
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
