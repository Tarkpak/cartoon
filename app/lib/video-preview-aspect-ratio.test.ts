import { describe, expect, it } from 'vitest'
import { resolveVideoPreviewAspectRatio } from './video-preview-aspect-ratio'

describe('resolveVideoPreviewAspectRatio', () => {
  it('preserves landscape, portrait, and square project ratios', () => {
    expect(resolveVideoPreviewAspectRatio('16:9')).toEqual({ cssValue: '16 / 9', portrait: false })
    expect(resolveVideoPreviewAspectRatio('9:16')).toEqual({ cssValue: '9 / 16', portrait: true })
    expect(resolveVideoPreviewAspectRatio('1:1')).toEqual({ cssValue: '1 / 1', portrait: false })
  })

  it('falls back to landscape for missing or invalid ratios', () => {
    expect(resolveVideoPreviewAspectRatio(undefined)).toEqual({ cssValue: '16 / 9', portrait: false })
    expect(resolveVideoPreviewAspectRatio('invalid')).toEqual({ cssValue: '16 / 9', portrait: false })
    expect(resolveVideoPreviewAspectRatio('0:16')).toEqual({ cssValue: '16 / 9', portrait: false })
  })
})
