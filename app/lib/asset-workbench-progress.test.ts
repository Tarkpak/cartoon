import { describe, expect, it } from 'vitest'
import { buildAutoStages, buildQueueProgressSegments, generatedEpisodePlans, matchesSceneListFilter, resolveSceneListStatus } from './asset-workbench-progress'

describe('workflow stage completion', () => {
  it('completes script planning before scenes exist and waits for asset preparation', () => {
    const stages = buildAutoStages({ hasScenes: false, hasEpisodePlan: true, assetsReady: false, videosDone: false, finalDone: false, autoRunning: false, autoRunCurrentStage: null })
    expect(stages.map(stage => stage.status)).toEqual(['done', 'pending', 'pending', 'pending'])
  })
  it('does not mark an empty project complete', () => {
    const stages = buildAutoStages({ hasScenes: false, hasEpisodePlan: false, assetsReady: true, videosDone: false, finalDone: false, autoRunning: false, autoRunCurrentStage: null })
    expect(stages.every(stage => stage.status === 'pending')).toBe(true)
  })
})

describe('generated episode directory state', () => {
  it('does not count migration holding episodes as a generated directory', () => {
    expect(generatedEpisodePlans()).toEqual([])
    expect(generatedEpisodePlans([{ id: 'legacy-unassigned', title: '未分集内容' }])).toEqual([])
  })

  it('counts real plans and preserves migration data without mutating it', () => {
    const placeholder = { id: 'legacy-unassigned-1', title: '未分集内容' }
    const plan = { id: 'episode_1', title: '第一集', charCount: 100 }
    const items = [placeholder, plan]
    expect(generatedEpisodePlans(items)).toEqual([plan])
    expect(items).toEqual([placeholder, plan])
    expect(generatedEpisodePlans([{ ...placeholder, charCount: 100 }])).toHaveLength(1)
  })
})

describe('scene list status', () => {
  it('prefers running, then a finished video, then failures', () => {
    expect(resolveSceneListStatus({ videoStatus: 'error', referenceStatus: 'done' }, true)).toBe('running')
    expect(resolveSceneListStatus({ videoStatus: 'done', referenceStatus: 'error' }, false)).toBe('done')
    expect(resolveSceneListStatus({ videoStatus: 'pending', referenceStatus: 'error' }, false)).toBe('error')
    expect(resolveSceneListStatus({ videoStatus: 'pending', referenceStatus: 'pending' }, false)).toBe('pending')
  })

  it('filters unfinished and failed scenes', () => {
    expect(matchesSceneListFilter('done', 'all')).toBe(true)
    expect(matchesSceneListFilter('done', 'unfinished')).toBe(false)
    expect(matchesSceneListFilter('running', 'unfinished')).toBe(true)
    expect(matchesSceneListFilter('pending', 'error')).toBe(false)
    expect(matchesSceneListFilter('error', 'error')).toBe(true)
  })
})

describe('queue progress segments', () => {
  it('splits the bar into done, running, failed and not started', () => {
    const { total, segments } = buildQueueProgressSegments({ total: 0, done: 2, running: 1, error: 1 }, 8)
    expect(total).toBe(8)
    expect(segments.map(segment => [segment.key, segment.count, segment.percent])).toEqual([
      ['done', 2, 25],
      ['running', 1, 12.5],
      ['error', 1, 12.5],
      ['pending', 4, 50]
    ])
  })

  it('handles an empty queue', () => {
    const { total, segments } = buildQueueProgressSegments({ total: 0, done: 0, running: 0, error: 0 }, 0)
    expect(total).toBe(0)
    expect(segments.every(segment => segment.percent === 0)).toBe(true)
  })
})
