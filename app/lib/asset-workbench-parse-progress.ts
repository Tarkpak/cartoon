export type ParsePhaseStatus = 'pending' | 'running' | 'done' | 'error'

export interface ParseProgressDisplayState {
  streamState?: 'connecting' | 'waiting' | 'thinking' | 'receiving'
  outputChars?: number
  lastModelActivityAt?: number
  active?: boolean
  step?: string
  failedStep?: string | null
  kind?: 'episode' | 'directory'
  targetEpisodeId?: string
  targetEpisodeTitle?: string
  message?: string
  startedAt?: number | null
  finishedAt?: number | null
  chunkIndex?: number | null
  chunkCount?: number | null
  logs?: Array<{ id: string, message: string }>
}

export function buildParseProgressPhases(state: ParseProgressDisplayState, mode: 'episode' | 'directory') {
  const complete = state.step === 'completed' || state.step === 'episode-plan-completed'
  const step = state.step === 'error' ? state.failedStep : state.step
  const current = mode === 'directory' ? 0
    : step === 'merging' || step === 'completed' || complete ? 2
      : ['batch_generating', 'batch_retry', 'generating', 'parsing'].includes(step || '') ? 1 : 0
  const labels = mode === 'directory'
    ? ['生成分集目录']
    : ['全局视觉与角色方案', '生成详细分镜', '校验与保存']
  return labels.map((label, index) => ({
    label,
    status: (complete || index < current ? 'done'
      : index > current ? 'pending'
        : state.step === 'error' ? 'error' : 'running') as ParsePhaseStatus
  }))
}

export function formatParseElapsed(startedAt: number | null | undefined, end: number): string {
  const seconds = Math.max(0, Math.floor((end - (startedAt ?? end)) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function parseBatchSummary(state: ParseProgressDisplayState): string {
  const total = state.chunkCount
  const completed = state.chunkIndex
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 1) return ''
  if (typeof completed !== 'number' || !Number.isFinite(completed)) return ''
  return `已完成 ${Math.max(0, Math.min(total, Math.floor(completed)))} / ${Math.floor(total)} 批`
}

export function isSelectedEpisodeParsing(state: ParseProgressDisplayState | undefined, running: boolean, episodeId: string): boolean {
  return Boolean(running && episodeId && state?.kind === 'episode' && state.targetEpisodeId === episodeId)
}

export function shouldShowEpisodeParseProgress(state: ParseProgressDisplayState | undefined, running: boolean, episodeId: string): boolean {
  if (state?.kind !== 'episode') return false
  return running || (state.step === 'error' && state.targetEpisodeId === episodeId)
}
