import { describe, expect, it } from 'vitest'
import { mediaResourceDownloads } from './media-parser-resources'

describe('media parser resource downloads', () => {
  it('exposes multi-video, images, live photos, audio and subtitles together', () => {
    const resources = mediaResourceDownloads({
      mediaType: 'video', videoUrls: ['video-1', 'video-2'], imageUrls: ['image-1'],
      livePhotos: [{ imageIndex: 2, url: 'live-video' }], audioUrl: 'audio',
      subtitles: [{ start: 0, end: 1, text: '字幕' }]
    })
    expect(resources.map(resource => resource.kind)).toEqual(['video', 'video', 'image', 'livePhoto', 'audio', 'subtitles'])
    expect(resources.find(resource => resource.kind === 'livePhoto')?.label).toContain('第 3 张')
  })

  it('handles missing resources and avoids duplicating the primary download', () => {
    expect(mediaResourceDownloads({})).toEqual([])
    expect(mediaResourceDownloads({ mediaType: 'image', imageUrls: ['image'] })).toEqual([])
    expect(mediaResourceDownloads({ mediaType: 'audio', audioUrl: 'audio' })).toEqual([])
  })
})
