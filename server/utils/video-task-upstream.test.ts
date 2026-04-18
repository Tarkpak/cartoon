import { describe, expect, it } from 'vitest'
import {
  parseVideoTaskMetadata,
  patchUpstreamVideoTaskMetadata,
  setUpstreamVideoTaskMetadata
} from './video-task-upstream'

describe('video-task-upstream', () => {
  it('stores upstream task tracking metadata', () => {
    const metadata = setUpstreamVideoTaskMetadata(null, {
      provider: 'qwen',
      taskId: 'task_123',
      modelId: 'wan2.6-t2v',
      resultMetadata: {
        duration: 10,
        resolution: '720p',
        aspectRatio: '16:9',
        fps: 24,
        hasAudio: true
      }
    })

    expect(parseVideoTaskMetadata(metadata).upstreamTask).toEqual({
      provider: 'qwen',
      taskId: 'task_123',
      modelId: 'wan2.6-t2v',
      resultMetadata: {
        duration: 10,
        resolution: '720p',
        aspectRatio: '16:9',
        fps: 24,
        hasAudio: true
      }
    })
  })

  it('patches existing upstream task metadata', () => {
    const initial = setUpstreamVideoTaskMetadata(null, {
      provider: 'kling',
      taskId: 'task_456',
      endpoint: '/v1/videos/text2video',
      resultMetadata: {
        duration: 8,
        resolution: '1080p',
        aspectRatio: '9:16',
        fps: 24,
        hasAudio: false
      }
    })

    const patched = patchUpstreamVideoTaskMetadata(initial, {
      timedOutAt: '2026-04-18T00:00:00.000Z'
    })

    expect(parseVideoTaskMetadata(patched).upstreamTask).toMatchObject({
      provider: 'kling',
      taskId: 'task_456',
      endpoint: '/v1/videos/text2video',
      timedOutAt: '2026-04-18T00:00:00.000Z'
    })
  })
})
