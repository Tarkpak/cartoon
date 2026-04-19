import { describe, expect, it } from 'vitest'
import {
  buildDefaultCropSelection,
  normalizeCropSelection,
  resolveCropSelectionCoverage,
  resolveMaxCropSelection
} from './asset-workbench-environment-panorama'

describe('environment panorama crop helpers', () => {
  it('builds a centered vertical crop from a wide panorama', () => {
    const selection = buildDefaultCropSelection({
      imageWidth: 1280,
      imageHeight: 720,
      aspectRatio: '9:16'
    })

    expect(selection.width).toBeCloseTo(0.3164, 3)
    expect(selection.height).toBeCloseTo(1, 3)
    expect(selection.x).toBeCloseTo((1 - selection.width) / 2, 5)
    expect(selection.y).toBeCloseTo((1 - selection.height) / 2, 5)
  })

  it('normalizes an out-of-bounds selection back into the image', () => {
    const selection = normalizeCropSelection(
      { x: 0.8, y: 0.7, width: 0.6, height: 0.6 },
      1280,
      720,
      '16:9'
    )

    expect(selection).toBeTruthy()
    expect(selection?.x).toBeGreaterThanOrEqual(0)
    expect(selection?.y).toBeGreaterThanOrEqual(0)
    expect((selection?.x || 0) + (selection?.width || 0)).toBeLessThanOrEqual(1)
    expect((selection?.y || 0) + (selection?.height || 0)).toBeLessThanOrEqual(1)
  })

  it('upgrades legacy default coverage selections to full range', () => {
    const normalized = normalizeCropSelection(
      {
        x: 0.37025,
        y: 0.09,
        width: 0.2595,
        height: 0.82
      },
      1280,
      720,
      '9:16'
    )

    expect(normalized).toBeTruthy()
    expect(normalized?.height).toBeCloseTo(1, 3)
  })

  it('calculates coverage against the max valid crop area', () => {
    const maxSelection = resolveMaxCropSelection(1280, 720, '1:1')
    const coverage = resolveCropSelectionCoverage(
      {
        x: 0.2,
        y: 0.1,
        width: maxSelection.width * 0.5,
        height: maxSelection.height * 0.5
      },
      1280,
      720,
      '1:1'
    )

    expect(coverage).toBeCloseTo(0.5, 5)
  })
})
