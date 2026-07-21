import { describe, expect, it } from 'bun:test'
import { mergeModelLogMediaRefs, mergeModelLogResponse } from './model-call-log-merge'

describe('model call log result merging', () => {
  it('preserves a CDN result when an earlier provider response arrives later', () => {
    const merged = mergeModelLogResponse(
      JSON.stringify({ source: { kind: 'data-url' }, imageUrl: 'https://cdn.example.com/result.png' }),
      { source: { kind: 'data-url' } }
    )

    expect(merged).toEqual({
      source: { kind: 'data-url' },
      imageUrl: 'https://cdn.example.com/result.png'
    })
  })

  it('keeps ready media references when duplicate event updates race', () => {
    const ready = {
      direction: 'response',
      mediaType: 'video',
      path: '$.videoUrl',
      url: 'https://cdn.example.com/result.mp4',
      status: 'ready'
    }
    const merged = mergeModelLogMediaRefs(JSON.stringify([ready]), [{
      direction: 'response',
      mediaType: 'video',
      path: '$.source',
      status: 'skipped'
    }])

    expect(merged).toContainEqual(ready)
  })
})
