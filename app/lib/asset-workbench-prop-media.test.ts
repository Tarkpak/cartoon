import { describe, expect, it } from 'vitest'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import { isPropAssetMediaReady, resolvePropAssetMediaType } from './asset-workbench-prop-media'

function createProp(input: Partial<PropAsset>): PropAsset {
  return { id: 'p', name: '素材', description: '', category: 'other', ...input }
}

describe('prop asset media', () => {
  it('treats props as images regardless of attached media', () => {
    expect(resolvePropAssetMediaType(createProp({ category: 'prop', mediaType: 'video' }))).toBe('image')
  })

  it('infers media type for other assets without an explicit type', () => {
    expect(resolvePropAssetMediaType(createProp({ videoAsset: { videoUrl: 'a.mp4', updatedAt: '' } }))).toBe('video')
    expect(resolvePropAssetMediaType(createProp({ name: '旁白音色' }))).toBe('voice')
    expect(resolvePropAssetMediaType(createProp({}))).toBe('image')
  })

  it('counts an uploaded video asset as ready', () => {
    expect(isPropAssetMediaReady(createProp({
      mediaType: 'video',
      videoAsset: { videoUrl: 'a.mp4', updatedAt: '' }
    }))).toBe(true)
    expect(isPropAssetMediaReady(createProp({ mediaType: 'video', referenceImage: 'a.png' }))).toBe(false)
    expect(isPropAssetMediaReady(createProp({ mediaType: 'voice', voiceAsset: { audioUrl: 'a.mp3', locked: true, updatedAt: '' } }))).toBe(true)
  })
})
