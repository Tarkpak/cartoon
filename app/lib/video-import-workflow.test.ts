import { describe, expect, it } from 'vitest'
import {
  buildVideoImportStages,
  findEpisodeSectionOffset,
  friendlyVideoImportError,
  hasMultipleEpisodeSections,
  resolveVideoImportActions,
  resolveVideoImportRecovery,
  resolveVideoImportStageIndex,
  videoImportNextStepHint,
  videoImportStatusLabel
} from './video-import-workflow'

describe('video import stages', () => {
  it('maps running and waiting statuses to stages', () => {
    expect(resolveVideoImportStageIndex({ status: 'transcribing' })).toBe(0)
    expect(resolveVideoImportStageIndex({ status: 'subtitle_ready' })).toBe(1)
    expect(resolveVideoImportStageIndex({ status: 'generating_script' })).toBe(2)
    expect(resolveVideoImportStageIndex({ status: 'imported' })).toBe(3)
  })

  it('places failed and cancelled tasks on the step they stopped at', () => {
    expect(resolveVideoImportStageIndex({ status: 'failed', currentStep: 'generate_script' })).toBe(2)
    expect(resolveVideoImportStageIndex({ status: 'cancelled', currentStep: 'import' })).toBe(3)
    expect(resolveVideoImportStageIndex({ status: 'failed', currentStep: 'copy_source' })).toBe(0)
  })

  it('marks the active stage as failed and earlier stages complete', () => {
    const stages = buildVideoImportStages({ status: 'failed', currentStep: 'import' })
    expect(stages.map(stage => stage.state)).toEqual(['complete', 'complete', 'complete', 'failed'])
    expect(buildVideoImportStages({ status: 'transcribing' })[0]!.state).toBe('running')
    expect(buildVideoImportStages({ status: 'imported' }).every(stage => stage.state === 'complete')).toBe(true)
  })
})

describe('video import recovery', () => {
  it('resumes from the step that failed', () => {
    expect(resolveVideoImportRecovery({ status: 'failed', currentStep: 'extract' })?.step).toBe('extract')
    expect(resolveVideoImportRecovery({ status: 'failed', currentStep: 'transcribe' })?.step).toBe('transcribe')
    expect(resolveVideoImportRecovery({ status: 'cancelled', currentStep: 'generate_script' })?.step).toBe('generate_script')
    expect(resolveVideoImportRecovery({ status: 'failed', currentStep: 'parse_episode' })?.step).toBe('import')
    expect(resolveVideoImportRecovery({ status: 'script_ready' })).toBeNull()
  })

  it('labels series retries as failed episodes only', () => {
    expect(resolveVideoImportRecovery({ status: 'failed', currentStep: 'transcribe', isSeriesGroup: true })?.label).toBe('重新识别失败分集')
  })
})

describe('video import actions', () => {
  const base = { subtitleText: '字幕', scriptText: '' }

  it('offers generating the script after subtitles are ready', () => {
    const actions = resolveVideoImportActions({ ...base, task: { status: 'subtitle_ready' } })
    expect(actions.primary).toBe('generate_script')
    expect(actions.canEditSubtitle).toBe(true)
    expect(actions.canEditScript).toBe(false)
  })

  it('locks editing while a background job or episode is running', () => {
    const actions = resolveVideoImportActions({
      ...base,
      task: { status: 'subtitle_ready', isSeriesGroup: true },
      episodes: [{ status: 'subtitle_ready' }, { status: 'transcribing' }]
    })
    expect(actions.running).toBe(true)
    expect(actions.canEditSubtitle).toBe(false)
    expect(actions.canGenerateScript).toBe(false)
    expect(actions.canCancel).toBe(true)
  })

  it('suggests regenerating when subtitles changed after the script', () => {
    const detail = { subtitleText: '字幕', scriptText: '剧本', task: { status: 'script_ready' } }
    expect(resolveVideoImportActions(detail).primary).toBe('create_project')
    expect(resolveVideoImportActions({ ...detail, scriptOutdated: true }).primary).toBe('regenerate_script')
  })

  it('opens the project once imported', () => {
    const actions = resolveVideoImportActions({ ...base, task: { status: 'imported' }, projectId: 'p1' })
    expect(actions.primary).toBe('open_project')
    expect(actions.canEditSubtitle).toBe(false)
  })

  it('does not offer script generation for a task that failed before transcription finished', () => {
    const actions = resolveVideoImportActions({ subtitleText: '', task: { status: 'failed', currentStep: 'transcribe' } })
    expect(actions.canGenerateScript).toBe(false)
    expect(actions.recovery?.step).toBe('transcribe')
  })
})

describe('video import text helpers', () => {
  it('detects multi-episode text and locates sections', () => {
    const text = '# 剧名\n\n## 第1集：开场\n内容\n\n## 第 2 集：反转\n内容'
    expect(hasMultipleEpisodeSections(text)).toBe(true)
    expect(hasMultipleEpisodeSections('## 第1集：开场\n内容')).toBe(false)
    expect(text.slice(findEpisodeSectionOffset(text, 2))).toMatch(/^## 第 2 集/)
    expect(findEpisodeSectionOffset(text, 9)).toBe(-1)
  })

  it('formats labels and hints', () => {
    expect(videoImportStatusLabel('script_ready', '科普脚本')).toBe('待校对科普脚本')
    expect(videoImportNextStepHint({ status: 'failed', currentStep: 'import' })).toBe('重新创建项目')
    expect(friendlyVideoImportError('FFMPEG_NOT_FOUND: x')).toContain('ffmpeg')
    expect(friendlyVideoImportError('其他错误')).toBe('其他错误')
  })
})
