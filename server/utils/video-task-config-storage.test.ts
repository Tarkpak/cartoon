import { describe, expect, it } from 'vitest'
import type { GenerateVideoRequest } from '../../shared/types/video'
import { normalizeVideoTaskConfigForStorage } from './video-task-config-storage'

type VideoTaskConfig = GenerateVideoRequest['config']

describe('normalizeVideoTaskConfigForStorage', () => {
  it('persists embedded media to links and deduplicates reference images', async () => {
    const imageCalls: string[] = []
    const audioCalls: string[] = []
    const imageUrlBySource = new Map<string, string>()
    const audioUrlBySource = new Map<string, string>()

    const config: VideoTaskConfig = {
      prompt: 'test prompt',
      duration: 8,
      resolution: '720p',
      aspectRatio: '16:9',
      model: 'standard',
      imageUrl: 'data:image/png;base64,AAAA',
      firstFrame: 'data:image/png;base64,BBBB',
      lastFrame: 'https://example.com/last.png',
      referenceImages: [
        'data:image/png;base64,AAAA',
        'data:image/png;base64,CCCC',
        'https://example.com/ref.png',
        'data:image/png;base64,CCCC'
      ],
      audioUrl: 'data:audio/mpeg;base64,DDDD'
    }

    const normalized = await normalizeVideoTaskConfigForStorage({
      taskId: 'video_task_demo',
      config,
      mediaPersister: {
        async persistImageSource({ source, prefix }) {
          imageCalls.push(`${prefix}:${source.slice(0, 24)}`)
          if (!imageUrlBySource.has(source)) {
            imageUrlBySource.set(source, `https://cdn.example/images/${imageUrlBySource.size + 1}.png`)
          }
          return imageUrlBySource.get(source) as string
        },
        async persistAudioSource({ source, prefix }) {
          audioCalls.push(`${prefix}:${source.slice(0, 24)}`)
          if (!audioUrlBySource.has(source)) {
            audioUrlBySource.set(source, `https://cdn.example/audio/${audioUrlBySource.size + 1}.mp3`)
          }
          return audioUrlBySource.get(source) as string
        }
      }
    })

    expect(imageCalls.length).toBe(3)
    expect(audioCalls.length).toBe(1)

    expect(normalized.imageUrl?.startsWith('https://cdn.example/images/')).toBe(true)
    expect(normalized.firstFrame?.startsWith('https://cdn.example/images/')).toBe(true)
    expect(normalized.lastFrame).toBe('https://example.com/last.png')
    expect(normalized.referenceImages?.length).toBe(3)
    expect(normalized.referenceImages?.[0]).toBe(normalized.imageUrl)
    expect(normalized.referenceImages?.includes('https://example.com/ref.png')).toBe(true)
    expect(normalized.audioUrl?.startsWith('https://cdn.example/audio/')).toBe(true)

    expect(normalized.imageUrl?.startsWith('data:')).toBe(false)
    expect(normalized.firstFrame?.startsWith('data:')).toBe(false)
    expect(normalized.referenceImages?.some(item => item.startsWith('data:'))).toBe(false)
  })

  it('keeps remote urls untouched without calling media persisters', async () => {
    let imageCallCount = 0
    let audioCallCount = 0

    const config: VideoTaskConfig = {
      prompt: 'remote only',
      duration: 8,
      resolution: '720p',
      aspectRatio: '16:9',
      model: 'standard',
      imageUrl: 'https://example.com/image.png',
      referenceImages: ['https://example.com/ref1.png', 'https://example.com/ref2.png'],
      audioUrl: 'https://example.com/audio.mp3'
    }

    const normalized = await normalizeVideoTaskConfigForStorage({
      taskId: 'video_task_remote',
      config,
      mediaPersister: {
        async persistImageSource() {
          imageCallCount += 1
          return 'https://cdn.example/should-not-be-called.png'
        },
        async persistAudioSource() {
          audioCallCount += 1
          return 'https://cdn.example/should-not-be-called.mp3'
        }
      }
    })

    expect(imageCallCount).toBe(0)
    expect(audioCallCount).toBe(0)
    expect(normalized).toEqual(config)
  })
})
