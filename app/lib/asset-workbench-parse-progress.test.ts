import { describe, expect, it } from 'vitest'
import { buildParseProgressPhases, formatParseElapsed, parseBatchSummary, isSelectedEpisodeParsing, shouldShowEpisodeParseProgress } from './asset-workbench-parse-progress'

describe('parse progress display', () => {
  it('shows completed planning and running batches, including retries', () => {
    for (const step of ['batch_generating', 'batch_retry', 'generating']) {
      expect(buildParseProgressPhases({ step }, 'episode').map(phase => phase.status))
        .toEqual(['done', 'running', 'pending'])
    }
    expect(parseBatchSummary({ chunkIndex: 2, chunkCount: 4 })).toBe('已完成 2 / 4 批')
  })

  it('retains the failed phase and marks completed phases correctly', () => {
    expect(buildParseProgressPhases({ step: 'error', failedStep: 'merging' }, 'episode').map(phase => phase.status))
      .toEqual(['done', 'done', 'error'])
    expect(buildParseProgressPhases({ step: 'completed' }, 'episode').every(phase => phase.status === 'done')).toBe(true)
    expect(buildParseProgressPhases({ step: 'episode-plan' }, 'directory')).toEqual([
      { label: '生成分集目录', status: 'running' }
    ])
  })

  it('keeps an active task visible while browsing another episode or remounting', () => {
    const state = { kind: 'episode' as const, targetEpisodeId: 'ep1', step: 'batch_generating' }
    expect(isSelectedEpisodeParsing(state, true, 'ep1')).toBe(true)
    expect(isSelectedEpisodeParsing(state, true, 'ep2')).toBe(false)
    expect(isSelectedEpisodeParsing(undefined, false, '')).toBe(false)
    expect(shouldShowEpisodeParseProgress(state, true, 'ep2')).toBe(true)
    expect(shouldShowEpisodeParseProgress({ ...state, step: 'error' }, false, 'ep2')).toBe(false)
    expect(shouldShowEpisodeParseProgress({ ...state, step: 'error' }, false, 'ep1')).toBe(true)
    expect(buildParseProgressPhases({ step: 'error', failedStep: 'completed' }, 'episode').map(phase => phase.status))
      .toEqual(['done', 'done', 'error'])
  })

  it('formats elapsed time and handles missing or invalid batch counts', () => {
    expect(formatParseElapsed(1000, 157000)).toBe('02:36')
    expect(formatParseElapsed(null, 157000)).toBe('00:00')
    expect(formatParseElapsed(2000, 1000)).toBe('00:00')
    expect(parseBatchSummary({})).toBe('')
    expect(parseBatchSummary({ chunkIndex: 1, chunkCount: Number.NaN })).toBe('')
    expect(parseBatchSummary({ chunkIndex: 9, chunkCount: 4 })).toBe('已完成 4 / 4 批')
  })
})
