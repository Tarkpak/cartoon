import { describe, expect, it } from 'vitest'
import {
  normalizeEnhanceTasks,
  normalizeVideoImportTasks,
  sortGlobalTasks,
  summarizeGlobalTasks
} from './global-tasks'

describe('global tasks', () => {
  it('maps enhance task statuses and links back to the task view', () => {
    const tasks = normalizeEnhanceTasks('video-enhance', [
      { taskId: 'a', fileName: 'a.mp4', kindLabel: '标准', status: 'processing', progress: 42, updatedAt: '2026-11-03T10:00:00Z' },
      { taskId: 'b', fileName: 'b.mp4', status: 'failed', errorMessage: '超时', updatedAt: '2026-11-03T09:00:00Z' },
      { taskId: 'c', fileName: 'c.mp4', status: 'idle' }
    ])
    expect(tasks.map(task => [task.key, task.status, task.progress, task.detail])).toEqual([
      ['video-enhance:a', 'running', 42, '标准'],
      ['video-enhance:b', 'failed', undefined, '超时']
    ])
    expect(tasks[0]!.to).toEqual({ path: '/tools/enhance', query: { type: 'video', view: 'tasks', taskId: 'a' } })
  })

  it('keeps percent progress and clamps it', () => {
    const [task] = normalizeEnhanceTasks('image-enhance', [
      { taskId: 'x', fileName: 'x.png', status: 'processing', progress: 130 }
    ])
    expect(task!.progress).toBe(100)
  })

  it('reports a video import series once, through its group row', () => {
    const tasks = normalizeVideoImportTasks([
      { id: 'group', originalFilename: '剧集', status: 'transcribing', progress: 30, createdAt: '', updatedAt: '', isSeriesGroup: true, seriesId: 's' },
      { id: 'ep1', originalFilename: '第1集', status: 'transcribing', createdAt: '', updatedAt: '', seriesId: 's' },
      { id: 'single', originalFilename: '单集', status: 'cancelled', createdAt: '', updatedAt: '' }
    ])
    expect(tasks.map(task => [task.key, task.status, task.to])).toEqual([
      ['video-import:group', 'running', '/import/video/group'],
      ['video-import:single', 'failed', '/import/video/single']
    ])
  })

  it('orders running, failed, done and counts each', () => {
    const tasks = sortGlobalTasks([
      ...normalizeEnhanceTasks('subtitle-erasure', [
        { taskId: 'old-done', fileName: '', status: 'completed', updatedAt: '2026-11-01T00:00:00Z' },
        { taskId: 'new-done', fileName: '', status: 'completed', updatedAt: '2026-11-02T00:00:00Z' },
        { taskId: 'fail', fileName: '', status: 'failed', updatedAt: '2026-10-01T00:00:00Z' },
        { taskId: 'run', fileName: '', status: 'processing', updatedAt: '2026-09-01T00:00:00Z' }
      ])
    ])
    expect(tasks.map(task => task.title)).toEqual(['run', 'fail', 'new-done', 'old-done'])
    expect(summarizeGlobalTasks(tasks)).toEqual({ running: 1, failed: 1, done: 2 })
  })
})
