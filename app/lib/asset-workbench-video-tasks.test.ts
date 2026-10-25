import { afterEach, describe, expect, it, vi } from 'vitest'
import { pollSceneVideoTask } from '~/lib/asset-workbench-scene-generation'
import {
  fetchActiveSceneVideoTasks,
  isVideoTaskStatusUnavailableError
} from '~/lib/asset-workbench-video-tasks'

function statusResponse(status: string, result?: { videoData?: string, lastFrame?: string }) {
  return { success: true, task: { status, result } }
}

function httpError(statusCode: number) {
  return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })
}

describe('asset-workbench-video-tasks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps polling through transient status errors', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(httpError(502))
      .mockResolvedValueOnce(statusResponse('processing'))
      .mockResolvedValueOnce(statusResponse('completed', {
        videoData: 'https://example.com/video.mp4',
        lastFrame: 'https://example.com/last.png'
      }))
    vi.stubGlobal('$fetch', fetchMock)

    await expect(pollSceneVideoTask('task_1', { pollIntervalMs: 0 })).resolves.toEqual({
      videoUrl: 'https://example.com/video.mp4',
      lastFrame: 'https://example.com/last.png'
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('reports the task as possibly still running after repeated status errors', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const error = await pollSceneVideoTask('task_2', {
      pollIntervalMs: 0,
      maxConsecutiveStatusErrors: 3
    }).catch(value => value)

    expect(isVideoTaskStatusUnavailableError(error)).toBe(true)
    expect(error.taskId).toBe('task_2')
  })

  it('treats polling timeout as possibly still running', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(statusResponse('processing')))

    const error = await pollSceneVideoTask('task_3', {
      pollIntervalMs: 0,
      maxAttempts: 2
    }).catch(value => value)

    expect(isVideoTaskStatusUnavailableError(error)).toBe(true)
  })

  it('stops immediately when the task no longer exists', async () => {
    const fetchMock = vi.fn().mockRejectedValue(httpError(404))
    vi.stubGlobal('$fetch', fetchMock)

    const error = await pollSceneVideoTask('task_4', { pollIntervalMs: 0 }).catch(value => value)

    expect(isVideoTaskStatusUnavailableError(error)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops tracking when the provider reports failure', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      success: true,
      task: { status: 'failed', error: '内容审核未通过' }
    }))

    const error = await pollSceneVideoTask('task_5', { pollIntervalMs: 0 }).catch(value => value)

    expect(isVideoTaskStatusUnavailableError(error)).toBe(false)
    expect(error.message).toBe('内容审核未通过')
  })

  it('normalizes active task listing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      success: true,
      tasks: [
        { taskId: 'task_a', sceneId: 'scene_a', status: 'processing' },
        { taskId: '', sceneId: 'scene_b', status: 'pending' }
      ]
    })
    vi.stubGlobal('$fetch', fetchMock)

    await expect(fetchActiveSceneVideoTasks('project_1')).resolves.toEqual([
      { taskId: 'task_a', sceneId: 'scene_a', status: 'processing' }
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/asset-workflow/video/active-tasks', {
      query: { projectId: 'project_1' }
    })
  })
})
