import { describe, expect, it, vi } from 'vitest'
import { pollModelTestVideoTask } from './model-test-video'

describe('pollModelTestVideoTask', () => {
  it('waits for the task and returns the completed video', async () => {
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce({ success: true, task: { status: 'processing' } })
      .mockResolvedValueOnce({
        success: true,
        task: {
          status: 'completed',
          result: {
            videoData: '/api/video/file/test.mp4',
            lastFrame: '/api/image/file/last.png',
            metadata: { provider: 'kling' }
          }
        }
      })
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(pollModelTestVideoTask('test_1', { fetchStatus, wait })).resolves.toEqual({
      videoUrl: '/api/video/file/test.mp4',
      lastFrame: '/api/image/file/last.png',
      metadata: { provider: 'kling' }
    })
    expect(wait).toHaveBeenCalledOnce()
  })

  it('surfaces the backend task error', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      success: true,
      task: {
        status: 'failed',
        error: '429 Too Many Requests: Account balance not enough'
      }
    })

    await expect(pollModelTestVideoTask('test_2', { fetchStatus }))
      .rejects.toThrow('429 Too Many Requests: Account balance not enough')
  })

  it('reports a missing video URL instead of a false success', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      success: true,
      task: { status: 'completed', result: {} }
    })

    await expect(pollModelTestVideoTask('test_3', { fetchStatus }))
      .rejects.toThrow('视频测试已完成，但未返回可预览的视频地址')
  })
})
