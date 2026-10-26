import { describe, expect, it } from 'vitest'
import { buildWorkbenchTasks, type WorkbenchTaskSource } from './asset-workbench-tasks'

function source(overrides: Partial<WorkbenchTaskSource> = {}): WorkbenchTaskSource {
  return { parsing: false, scenes: [], queueItems: [], characters: [], environments: [], ...overrides }
}

describe('buildWorkbenchTasks', () => {
  it('returns nothing when the project is idle', () => {
    expect(buildWorkbenchTasks(source({
      scenes: [{ id: 's1', title: '老街', referenceStatus: 'done', videoStatus: 'done' }],
      characters: [{ id: 'c1', name: '陈泽', generating: false }]
    }))).toEqual([])
  })

  it('lists running work before failures', () => {
    const tasks = buildWorkbenchTasks(source({
      scenes: [
        { id: 's1', title: '老街', referenceStatus: 'done', videoStatus: 'error', videoError: '审核未通过' },
        { id: 's2', title: '虚空', referenceStatus: 'done', videoStatus: 'generating' }
      ],
      characters: [{ id: 'c1', name: '陈泽', generating: true }]
    }))
    expect(tasks.map(task => [task.id, task.status])).toEqual([
      ['character:c1', 'running'],
      ['scene:s2', 'running'],
      ['scene:s1', 'error']
    ])
    expect(tasks[2]).toMatchObject({ title: '场景 1 · 老街', detail: '审核未通过', retryable: true, stage: 'videos', sceneId: 's1' })
  })

  it('treats a running queue item as preparing and falls back to the queue error', () => {
    const tasks = buildWorkbenchTasks(source({
      scenes: [
        { id: 's1', title: 'A', referenceStatus: 'pending', videoStatus: 'pending' },
        { id: 's2', title: 'B', referenceStatus: 'done', videoStatus: 'error' }
      ],
      queueItems: [
        { sceneId: 's1', status: 'running' },
        { sceneId: 's2', status: 'error', error: '超时' }
      ]
    }))
    expect(tasks.map(task => task.detail)).toEqual(['准备中', '超时'])
  })

  it('ignores an old environment-image failure once the scene video is done', () => {
    expect(buildWorkbenchTasks(source({
      scenes: [{ id: 's1', title: 'A', referenceStatus: 'error', videoStatus: 'done' }]
    }))).toEqual([])
  })

  it('includes parsing and environment work', () => {
    const tasks = buildWorkbenchTasks(source({
      parsing: true,
      parseMessage: '正在解析第 2 集',
      environments: [{ id: 'e1', name: '窝棚', referenceStatus: 'error', referenceError: '' }]
    }))
    expect(tasks).toMatchObject([
      { id: 'parse', status: 'running', detail: '正在解析第 2 集', stage: 'parse' },
      { id: 'environment:e1', status: 'error', detail: '环境图生成失败', stage: 'assets' }
    ])
  })
})
