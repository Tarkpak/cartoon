// 视频转项目的状态机、展示文案和可执行操作。页面只依赖这里推导出的结果，
// 不在模板里散落状态判断。

export type VideoImportStatus =
  | 'pending'
  | 'extracting'
  | 'transcribing'
  | 'subtitle_ready'
  | 'generating_script'
  | 'script_ready'
  | 'importing'
  | 'imported'
  | 'failed'
  | 'cancelled'

export type VideoImportRetryStep = 'extract' | 'transcribe' | 'generate_script' | 'import'

export type VideoImportStageKey = 'transcribe' | 'subtitle' | 'script' | 'project'

export type VideoImportStageState = 'complete' | 'current' | 'running' | 'failed' | 'upcoming'

export interface VideoImportTaskLike {
  status: string
  currentStep?: string | null
  progress?: number | null
  errorMessage?: string | null
  isSeriesGroup?: boolean
}

export interface VideoImportDetailLike {
  task: VideoImportTaskLike
  episodes?: VideoImportTaskLike[]
  subtitleText?: string | null
  scriptText?: string | null
  scriptOutdated?: boolean
  projectId?: string | null
  jobRunning?: boolean
}

export const VIDEO_IMPORT_RUNNING_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'extracting',
  'transcribing',
  'generating_script',
  'importing'
])

const EDITABLE_STATUSES = new Set(['subtitle_ready', 'script_ready', 'failed', 'cancelled'])

export function isVideoImportRunning(status?: string | null) {
  return VIDEO_IMPORT_RUNNING_STATUSES.has(status || '')
}

const STATUS_LABELS: Record<string, string> = {
  pending: '排队中',
  extracting: '提取音频中',
  transcribing: '识别字幕中',
  subtitle_ready: '待校对字幕',
  generating_script: '生成剧本中',
  script_ready: '待校对剧本',
  importing: '创建项目中',
  imported: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

export function videoImportStatusLabel(status: string, scriptLabel = '剧本') {
  return (STATUS_LABELS[status] || status).replace('剧本', scriptLabel)
}

export type VideoImportBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'

export function videoImportStatusVariant(status: string): VideoImportBadgeVariant {
  if (status === 'failed') return 'destructive'
  if (status === 'imported') return 'success'
  if (status === 'cancelled') return 'secondary'
  if (status === 'subtitle_ready' || status === 'script_ready') return 'warning'
  return 'outline'
}

/** 列表页「下一步」提示，告诉用户这个任务在等什么。 */
export function videoImportNextStepHint(task: VideoImportTaskLike) {
  if (isVideoImportRunning(task.status)) return '处理中，可离开页面，完成后回来继续'
  if (task.status === 'subtitle_ready') return '校对字幕后生成剧本'
  if (task.status === 'script_ready') return '校对剧本后创建项目'
  if (task.status === 'imported') return '项目已创建'
  if (task.status === 'failed' || task.status === 'cancelled') return resolveVideoImportRecovery(task)?.label || ''
  return ''
}

const STEP_LABELS: Record<string, string> = {
  created: '已创建',
  queued: '排队中',
  copy_source: '准备源视频',
  extract: '提取音频',
  transcribe: '识别字幕',
  edit_subtitle: '保存字幕',
  subtitle_ready: '校对字幕',
  generate_script: '生成剧本',
  edit_script: '保存剧本',
  script_ready: '校对剧本',
  import: '创建项目',
  create_project: '新建项目',
  parse_script: '解析剧本',
  parse_episode: '解析分集',
  save_project: '保存项目',
  imported: '完成',
  cancel: '取消任务'
}

export function videoImportStepLabel(step: string) {
  return STEP_LABELS[step] || step
}

const RUN_STATUS_LABELS: Record<string, string> = {
  running: '进行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消'
}

export function videoImportRunStatusLabel(status: string) {
  return RUN_STATUS_LABELS[status] || status
}

export function videoImportRunStatusVariant(status: string): VideoImportBadgeVariant {
  if (status === 'failed') return 'destructive'
  if (status === 'success') return 'success'
  if (status === 'cancelled') return 'secondary'
  return 'outline'
}

const ARTIFACT_LABELS: Record<string, string> = {
  source_video: '源视频',
  extracted_audio: '提取音频',
  asr_raw_json: '识别原始结果',
  subtitle_txt: '字幕文本',
  subtitle_srt: '字幕 SRT',
  script_draft: '剧本草稿',
  script_edited: '编辑后剧本',
  parse_result: '项目解析结果'
}

export function videoImportArtifactLabel(kind: string) {
  return ARTIFACT_LABELS[kind] || kind
}

/** 失败或取消时从哪一步继续，以及按钮文案。 */
export function resolveVideoImportRecovery(
  task: VideoImportTaskLike,
  scriptLabel = '剧本'
): { step: VideoImportRetryStep, label: string } | null {
  if (task.status !== 'failed' && task.status !== 'cancelled') return null
  const step = task.currentStep || ''
  if (step === 'generate_script') return { step: 'generate_script', label: `继续生成${scriptLabel}` }
  if (['import', 'create_project', 'save_project', 'parse_episode', 'parse_script'].includes(step)) {
    return { step: 'import', label: '重新创建项目' }
  }
  if (['copy_source', 'extract'].includes(step)) {
    return { step: 'extract', label: task.isSeriesGroup ? '重新识别失败分集' : '重新识别' }
  }
  return { step: 'transcribe', label: task.isSeriesGroup ? '重新识别失败分集' : '重新识别' }
}

function stageIndexForStep(step: string): number {
  if (step === 'generate_script') return 2
  if (['import', 'create_project', 'save_project', 'parse_episode', 'parse_script'].includes(step)) return 3
  return 0
}

/** 当前所在阶段：0 识别字幕 / 1 校对字幕 / 2 剧本 / 3 创建项目。 */
export function resolveVideoImportStageIndex(task: VideoImportTaskLike): number {
  switch (task.status) {
    case 'pending':
    case 'extracting':
    case 'transcribing':
      return 0
    case 'subtitle_ready':
      return 1
    case 'generating_script':
    case 'script_ready':
      return 2
    case 'importing':
    case 'imported':
      return 3
    default:
      return stageIndexForStep(task.currentStep || '')
  }
}

export interface VideoImportStage {
  key: VideoImportStageKey
  label: string
  state: VideoImportStageState
}

export function buildVideoImportStages(task: VideoImportTaskLike, scriptLabel = '剧本'): VideoImportStage[] {
  const labels: Array<[VideoImportStageKey, string]> = [
    ['transcribe', '识别字幕'],
    ['subtitle', '校对字幕'],
    ['script', `校对${scriptLabel}`],
    ['project', '创建项目']
  ]
  const active = resolveVideoImportStageIndex(task)
  return labels.map(([key, label], index) => {
    let state: VideoImportStageState = 'upcoming'
    if (task.status === 'imported' || index < active) state = 'complete'
    else if (index === active) {
      if (task.status === 'failed' || task.status === 'cancelled') state = 'failed'
      else if (isVideoImportRunning(task.status)) state = 'running'
      else state = 'current'
    }
    return { key, label, state }
  })
}

export type VideoImportPrimaryAction = 'generate_script' | 'regenerate_script' | 'create_project' | 'open_project'

export interface VideoImportActions {
  running: boolean
  canEditSubtitle: boolean
  canEditScript: boolean
  canGenerateScript: boolean
  canCreateProject: boolean
  canCancel: boolean
  recovery: { step: VideoImportRetryStep, label: string } | null
  primary: VideoImportPrimaryAction | null
}

/** 由任务详情推导出页面可执行的全部操作，模板只读取结果。 */
export function resolveVideoImportActions(detail: VideoImportDetailLike | null, scriptLabel = '剧本'): VideoImportActions {
  const empty: VideoImportActions = {
    running: false,
    canEditSubtitle: false,
    canEditScript: false,
    canGenerateScript: false,
    canCreateProject: false,
    canCancel: false,
    recovery: null,
    primary: null
  }
  if (!detail) return empty
  const { task } = detail
  const episodesRunning = (detail.episodes || []).some(episode => isVideoImportRunning(episode.status))
  const running = isVideoImportRunning(task.status) || episodesRunning || !!detail.jobRunning
  const editable = !running && EDITABLE_STATUSES.has(task.status)
  const hasSubtitle = !!detail.subtitleText?.trim()
  const hasScript = !!detail.scriptText?.trim()
  const allEpisodesTranscribed = (detail.episodes || []).every(episode => !['pending', 'extracting', 'transcribing', 'failed', 'cancelled'].includes(episode.status))
  const canGenerateScript = editable && hasSubtitle && allEpisodesTranscribed
    && (task.status !== 'failed' && task.status !== 'cancelled' ? true : resolveVideoImportStageIndex(task) >= 1)
  const canCreateProject = editable && hasScript

  let primary: VideoImportPrimaryAction | null = null
  if (task.status === 'imported' && detail.projectId) primary = 'open_project'
  else if (task.status === 'subtitle_ready' && canGenerateScript) primary = 'generate_script'
  else if (task.status === 'script_ready' && detail.scriptOutdated && canGenerateScript) primary = 'regenerate_script'
  else if (task.status === 'script_ready' && canCreateProject) primary = 'create_project'

  return {
    running,
    canEditSubtitle: editable && hasSubtitle,
    canEditScript: editable && hasScript,
    canGenerateScript,
    canCreateProject,
    canCancel: isVideoImportRunning(task.status) || episodesRunning,
    recovery: running ? null : resolveVideoImportRecovery(task, scriptLabel),
    primary
  }
}

/** 文本中是否包含两个以上「## 第N集」分段（用于显示分集导航）。 */
export function hasMultipleEpisodeSections(text: string) {
  const numbers = new Set<number>()
  for (const match of text.matchAll(/^#{1,3}\s*第\s*(\d+)\s*[集段](?:[：:\s]|$)/gm)) {
    numbers.add(Number(match[1]))
    if (numbers.size >= 2) return true
  }
  return false
}

/** 第 N 集标题在文本中的字符偏移，找不到返回 -1。 */
export function findEpisodeSectionOffset(text: string, episodeNumber: number) {
  const match = new RegExp(`(^|\\n)#{1,3}\\s*第\\s*${episodeNumber}\\s*[集段]`).exec(text)
  if (!match) return -1
  return match.index + match[1]!.length
}

/** 把后端/网络错误转换成用户能看懂、知道怎么处理的提示。 */
export function friendlyVideoImportError(message?: string | null) {
  const raw = message || ''
  if (/FFMPEG_NOT_FOUND/i.test(raw)) return '未找到 ffmpeg，无法从视频提取音频。请安装 ffmpeg，或在环境变量 FFMPEG_PATH 中配置可执行文件路径。'
  if (/FFMPEG_FAILED/i.test(raw)) return '视频音频提取失败，请确认视频可以正常播放且包含音轨。'
  if (/SOURCE_FILE_NOT_FOUND|os error 2|系统找不到指定的文件/i.test(raw)) return '找不到源视频或临时音频文件，文件可能已被移动或删除，请重新导入。'
  if (/SOURCE_FILE_PERMISSION_DENIED|permission denied|operation not permitted/i.test(raw)) return '没有权限读取视频文件，请授予应用访问该文件夹的权限后重试。'
  if (/BCUT_INVALID_RESPONSE|BCUT_RESPONSE_READ_FAILED/i.test(raw)) return '语音识别服务返回异常，可能是网络中断或服务暂时不可用，请稍后重试。'
  if (/BCUT_HTTP_ERROR/i.test(raw)) return '语音识别服务暂时不可用或请求被限流，请稍后重试。'
  if (/BCUT_RATE_LIMITER_UNAVAILABLE/i.test(raw)) return '语音识别任务调度器暂时不可用，请稍后重试。'
  if (/FOREIGN KEY constraint failed/i.test(raw)) return '任务数据关联异常，请删除该任务后重新导入。'
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return '连接本地转换服务失败，请确认应用后端正在运行。'
  return raw
}
