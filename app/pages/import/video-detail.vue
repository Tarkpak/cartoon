<script setup lang="ts">
import {
  ArrowLeft,
  FileVideo,
  Wand2,
  Save,
  RotateCcw,
  Ban,
  FolderInput,
  AlertCircle,
  CheckCircle2,
  Pencil,
  Loader2
} from 'lucide-vue-next'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useVideoImport, type VideoImportRetryStep } from '@/composables/useVideoImport'
import {
  applyVideoImportRoleRenames,
  parseVideoImportRoleCandidates,
  type VideoImportRoleCandidate
} from '~/lib/video-import-role-naming'
import {
  normalizeScriptParseMode,
  type ScriptParseMode
} from '#shared/types/script'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
import StyleSelector from '@/components/StyleSelector.vue'

definePageMeta({
  layout: 'default'
})

const router = useRouter()
const route = useRoute()
const {
  activeTask,
  acting,
  error,
  fetchTask,
  updateSubtitle,
  generateScript,
  updateScript,
  importToProject,
  retryTask,
  cancelTask,
  deleteTask
} = useVideoImport()

const subtitleDraft = ref('')
const scriptDraft = ref('')
const contentView = ref<'subtitle' | 'script' | 'logs'>('subtitle')
const logsExpanded = ref(false)
const createProjectDialogOpen = ref(false)
const createProjectTitle = ref('')
const createProjectAspectRatio = ref<'16:9' | '9:16' | '1:1'>('9:16')
const createProjectScriptParseMode = ref<ScriptParseMode>('premium_drama')
const createProjectStyleId = ref('')
const roleNamingDialogOpen = ref(false)
const roleNamingDraft = ref<Array<VideoImportRoleCandidate & { name: string }>>([])
const selectedEpisodeNumber = ref<number | null>(null)
const retryingEpisodeId = ref<string | null>(null)
let refreshTimer: number | null = null
const routeTaskId = computed(() => {
  const raw = route.params.id
  return typeof raw === 'string' ? raw.trim() : ''
})
const {
  presets: availableStylePresets,
  categories: availableStyleCategories,
  defaultStyleId,
  loading: styleConfigLoading,
  error: styleConfigError,
  loadStylePresets
} = useStylePresets()

const runningStatuses = new Set(['pending', 'extracting', 'transcribing', 'generating_script', 'importing'])

const hasRunningTasks = computed(() => runningStatuses.has(selectedTask.value?.status || ''))
const selectedTask = computed(() => activeTask.value?.task || null)
const canEditSubtitle = computed(() => ['subtitle_ready', 'script_ready', 'failed'].includes(selectedTask.value?.status || ''))
const canGenerateScript = computed(() => !!selectedTask.value && ['subtitle_ready', 'script_ready', 'failed'].includes(selectedTask.value.status))
const canEditScript = computed(() => !!selectedTask.value && ['script_ready', 'failed'].includes(selectedTask.value.status))
const canImport = computed(() => !!selectedTask.value && ['script_ready', 'failed'].includes(selectedTask.value.status))
const canCancel = computed(() => !!selectedTask.value && runningStatuses.has(selectedTask.value.status))
const subtitleHasChanges = computed(() => subtitleDraft.value !== (activeTask.value?.subtitleText || ''))
const scriptHasChanges = computed(() => scriptDraft.value !== (activeTask.value?.scriptText || ''))
const showSubtitleNextStep = computed(() => canGenerateScript.value && selectedTask.value?.status === 'subtitle_ready')
const showScriptNextStep = computed(() => canImport.value && selectedTask.value?.status === 'script_ready')
const seriesEpisodes = computed(() => activeTask.value?.episodes || [])
const subtitleHasEpisodeSections = computed(() => hasMultipleEpisodeSections(subtitleDraft.value))
const scriptHasEpisodeSections = computed(() => hasMultipleEpisodeSections(scriptDraft.value))
const selectedScriptParseMode = computed<ScriptParseMode>(() => {
  return normalizeScriptParseMode(selectedTask.value?.config?.scriptParseMode)
})
const isOriginExplainerTask = computed(() => selectedScriptParseMode.value === 'origin_explainer')
const selectedImportContentLabel = computed(() => isOriginExplainerTask.value ? '科普内容' : '剧情内容')
function ensureCreateProjectStyleId() {
  if (
    !createProjectDialogOpen.value
    || isOriginExplainerTask.value
    || createProjectStyleId.value
  ) return

  const configuredStyleId = typeof selectedTask.value?.config?.styleId === 'string'
    ? selectedTask.value.config.styleId
    : ''
  const availableStyleIds = new Set(availableStylePresets.value.map(style => style.id))
  if (availableStyleIds.has(configuredStyleId)) {
    createProjectStyleId.value = configuredStyleId
    return
  }
  createProjectStyleId.value = availableStyleIds.has(defaultStyleId.value)
    ? defaultStyleId.value
    : (availableStylePresets.value[0]?.id || '')
}

watch(
  [availableStylePresets, defaultStyleId, createProjectDialogOpen],
  ensureCreateProjectStyleId
)
const scriptContentLabel = computed(() => isOriginExplainerTask.value ? '科普脚本' : '剧本')
const generateScriptActionLabel = computed(() => {
  return isOriginExplainerTask.value ? '确认字幕并生成科普脚本' : '确认字幕并生成剧本'
})
const seriesEpisodeStats = computed(() => {
  const episodes = seriesEpisodes.value
  const total = episodes.length
  const failed = episodes.filter(task => task.status === 'failed').length
  const done = episodes.filter(task => ['subtitle_ready', 'script_ready', 'importing', 'imported'].includes(task.status)).length
  const running = episodes.filter(task => runningStatuses.has(task.status)).length
  return { total, failed, done, running }
})
const workflowSteps = computed(() => {
  const status = selectedTask.value?.status || 'pending'
  const currentStep = selectedTask.value?.currentStep || ''
  let activeIndex = 0
  if (status === 'transcribing') activeIndex = 1
  if (status === 'subtitle_ready') activeIndex = 2
  if (['generating_script', 'script_ready'].includes(status)) activeIndex = 3
  if (['importing', 'imported'].includes(status)) activeIndex = 4
  if (status === 'failed') {
    if (currentStep === 'transcribe') activeIndex = 1
    if (currentStep === 'generate_script') activeIndex = 3
    if (currentStep === 'import') activeIndex = 4
  }
  const labels = ['提取内容', '识别字幕', '确认字幕', `确认${scriptContentLabel.value}`, '创建项目']
  return labels.map((label, index) => ({
    label,
    state: status === 'imported' || index < activeIndex
      ? 'complete'
      : index === activeIndex
        ? (status === 'failed' ? 'failed' : 'current')
        : 'upcoming'
  }))
})
const currentWorkflowStepNumber = computed(() => {
  const activeIndex = workflowSteps.value.findIndex(step => ['current', 'failed'].includes(step.state))
  return activeIndex >= 0 ? activeIndex + 1 : workflowSteps.value.length
})
const primaryAction = computed(() => {
  if (!selectedTask.value) return null
  if (showSubtitleNextStep.value) {
    return {
      label: generateScriptActionLabel.value,
      disabled: acting.value || !subtitleDraft.value.trim(),
      action: handleGenerateScript,
      icon: 'script'
    }
  }
  if (showScriptNextStep.value) {
    return {
      label: '确认并创建项目',
      disabled: acting.value || !scriptDraft.value.trim(),
      action: handleImport,
      icon: 'project'
    }
  }
  return null
})
const currentStageLabel = computed(() => {
  const task = selectedTask.value
  if (!task) return ''
  const map: Record<string, string> = {
    pending: '等待处理',
    extracting: '正在提取音频',
    transcribing: '正在识别字幕',
    subtitle_ready: '等待确认字幕',
    generating_script: '正在生成剧本',
    script_ready: '等待确认剧本',
    importing: '正在创建项目',
    imported: '项目已创建',
    failed: '任务失败',
    cancelled: '任务已取消'
  }
  return map[task.status] || statusLabel(task.status)
})
const contentTabs = computed(() => {
  const tabs: Array<{ key: 'subtitle' | 'script' | 'logs', label: string, badge: string }> = [
    {
      key: 'subtitle',
      label: '字幕内容',
      badge: selectedTask.value?.status === 'subtitle_ready' ? '待确认' : ''
    },
    {
      key: 'script',
      label: `${scriptContentLabel.value}内容`,
      badge: selectedTask.value?.status === 'script_ready' ? '待确认' : ''
    }
  ]
  if (activeTask.value?.stepRuns?.length || activeTask.value?.artifacts?.length) {
    tabs.push({
      key: 'logs',
      label: '执行记录',
      badge: activeTask.value?.stepRuns?.length ? String(activeTask.value.stepRuns.length) : ''
    })
  }
  return tabs
})
const detectedRoleCandidates = computed(() => {
  return parseVideoImportRoleCandidates(scriptDraft.value || activeTask.value?.scriptText || '')
})

function normalizeScriptForEditing(text: string) {
  return text
}

watch(activeTask, (value) => {
  subtitleDraft.value = value?.subtitleText || ''
  scriptDraft.value = normalizeScriptForEditing(value?.scriptText || '')
  selectedEpisodeNumber.value = value?.episodes?.[0]?.episodeNumber || null
  if (value?.task.status === 'script_ready') {
    contentView.value = 'script'
  } else if (value?.task.status === 'subtitle_ready') {
    contentView.value = 'subtitle'
  }
})

watch(roleNamingDialogOpen, (open) => {
  if (!open) return
  roleNamingDraft.value = detectedRoleCandidates.value.map(candidate => ({
    ...candidate,
    name: candidate.name
  }))
})

watch(hasRunningTasks, (running) => {
  syncRefreshTimer(running)
})

watch(routeTaskId, async (taskId) => {
  if (!taskId) {
    await router.replace('/import/video')
    return
  }
  await fetchTask(taskId)
}, { immediate: true })

onMounted(async () => {
  syncRefreshTimer(hasRunningTasks.value)
})

onUnmounted(() => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
})

function syncRefreshTimer(running: boolean) {
  if (typeof window === 'undefined') return
  if (running && !refreshTimer) {
    refreshTimer = window.setInterval(() => {
      if (routeTaskId.value) {
        void fetchTask(routeTaskId.value)
      }
    }, 2500)
  }
  if (!running && refreshTimer) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
}

async function handleSaveSubtitle() {
  if (!selectedTask.value) return
  await updateSubtitle(selectedTask.value.id, subtitleDraft.value)
}

async function handleGenerateScript() {
  if (!selectedTask.value) return
  if (subtitleHasChanges.value) {
    await updateSubtitle(selectedTask.value.id, subtitleDraft.value)
  }
  await generateScript(selectedTask.value.id)
  contentView.value = 'script'
}

async function handleSaveScript() {
  if (!selectedTask.value) return
  await updateScript(selectedTask.value.id, scriptDraft.value)
}

async function handleImport() {
  if (!selectedTask.value) return
  const taskId = selectedTask.value.id
  if (scriptHasChanges.value) {
    await updateScript(taskId, scriptDraft.value)
  }
  createProjectDialogOpen.value = false
  if (activeTask.value?.task.id === taskId) {
    activeTask.value = {
      ...activeTask.value,
      task: {
        ...activeTask.value.task,
        status: 'importing',
        currentStep: 'import',
        progress: Math.max(activeTask.value.task.progress || 0, 85),
        errorMessage: null
      }
    }
    syncRefreshTimer(true)
  }
  const result = await importToProject(taskId, {
    projectTitle: createProjectTitle.value.trim() || undefined,
    styleId: isOriginExplainerTask.value ? undefined : createProjectStyleId.value,
    aspectRatio: createProjectAspectRatio.value,
    scriptParseMode: createProjectScriptParseMode.value
  })
  if (result?.redirectUrl) {
    await router.push(result.redirectUrl)
  }
}

async function handleRetry(step: VideoImportRetryStep) {
  if (!selectedTask.value) return
  await retryTask(selectedTask.value.id, step)
}

async function handleRetryEpisode(taskId: string) {
  if (!routeTaskId.value || retryingEpisodeId.value) return
  retryingEpisodeId.value = taskId
  try {
    await retryTask(taskId, 'transcribe', routeTaskId.value)
    syncRefreshTimer(true)
  } finally {
    retryingEpisodeId.value = null
  }
}

async function handleCancel() {
  if (!selectedTask.value) return
  await cancelTask(selectedTask.value.id)
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: '准备中',
    extracting: '提取音频中',
    transcribing: '识别字幕中',
    subtitle_ready: '请确认字幕',
    generating_script: '生成剧本中',
    script_ready: '请确认剧本',
    importing: '创建项目中',
    imported: '已完成',
    failed: '失败',
    cancelled: '已取消'
  }
  return map[status] || status
}

function friendlyErrorMessage(message?: string | null) {
  const raw = message || ''
  if (/FOREIGN KEY constraint failed/i.test(raw)) {
    return '创建转换任务失败，任务数据关联异常。请重试；如果仍失败，请删除失败记录后再导入。'
  }
  if (/permission denied|denied|operation not permitted/i.test(raw)) {
    return '无法访问所选文件或文件夹，请检查系统权限后重试。'
  }
  return raw
}

function stepLabel(step: string) {
  const map: Record<string, string> = {
    created: '已创建',
    copy_source: '复制源视频',
    extract: '提取音频',
    transcribe: '识别字幕',
    edit_subtitle: '保存字幕',
    subtitle_ready: '确认字幕',
    generate_script: '生成剧本',
    edit_script: '保存剧本',
    script_ready: '确认剧本',
    create_project: '创建项目',
    parse_combined_script: '解析整剧',
    parse_episode: '解析分集',
    save_project: '保存项目',
    import: '创建项目',
    imported: '完成',
    retry: '重试中',
    processing: '处理中',
    cancel: '取消任务',
    cancelled: '已取消'
  }
  return map[step] || step
}

function runStatusLabel(status: string) {
  const map: Record<string, string> = {
    running: '进行中',
    success: '成功',
    failed: '失败',
    cancelled: '已取消'
  }
  return map[status] || status
}

function runStatusVariant(status: string) {
  if (status === 'failed') return 'destructive'
  if (status === 'success') return 'default'
  if (status === 'cancelled') return 'secondary'
  return 'outline'
}

function artifactKindLabel(kind: string) {
  const map: Record<string, string> = {
    source_video: '源视频',
    extracted_audio: '提取音频',
    asr_raw_json: '识别原始结果',
    subtitle_txt: '字幕文本',
    subtitle_srt: '字幕 SRT',
    script_draft: '剧本草稿',
    script_edited: '编辑后剧本',
    parse_result: '项目解析结果'
  }
  return map[kind] || kind
}

function formatDuration(value?: number | null) {
  if (value === null || value === undefined) return '进行中'
  if (value < 1000) return `${value} ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`
}

function statusVariant(status: string) {
  if (status === 'failed') return 'destructive'
  if (status === 'imported') return 'default'
  if (status === 'cancelled') return 'secondary'
  return 'outline'
}

function formatDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return ''
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

async function handleOpenArtifactPath(path: string) {
  const target = path.trim()
  if (!target) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_local_path', { path: target })
  } catch (error) {
    console.error('Failed to open artifact path:', error)
    window.alert('当前环境无法直接打开该文件。')
  }
}

function handleOpenRoleNamingDialog() {
  if (detectedRoleCandidates.value.length === 0) return
  roleNamingDialogOpen.value = true
}

function episodeStatusLabel(status: string) {
  if (status === 'failed') return '失败'
  if (runningStatuses.has(status)) return '处理中'
  if (['subtitle_ready', 'script_ready', 'importing', 'imported'].includes(status)) return '已就绪'
  return statusLabel(status)
}

function hasMultipleEpisodeSections(text: string) {
  const episodeNumbers = new Set<number>()
  for (const match of text.matchAll(/^#{1,3}\s*第\s*(\d+)\s*集(?:[：:\s]|$)/gm)) {
    const episodeNumber = Number(match[1])
    if (Number.isFinite(episodeNumber)) episodeNumbers.add(episodeNumber)
    if (episodeNumbers.size >= 2) return true
  }
  return false
}

function locateEpisode(episodeNumber?: number | null) {
  if (!episodeNumber) return
  selectedEpisodeNumber.value = episodeNumber
  const source = contentView.value === 'script' ? scriptDraft.value : subtitleDraft.value
  const pattern = new RegExp(`(?:^|\\n)#{0,3}\\s*第\\s*${episodeNumber}\\s*集`, 'm')
  const match = pattern.exec(source)
  if (!match) return

  nextTick(() => {
    const id = contentView.value === 'script' ? 'script-editor' : 'subtitle-editor'
    const editor = document.getElementById(id) as HTMLTextAreaElement | null
    if (!editor) return
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0)
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 24
    const lineCount = source.slice(0, start).split('\n').length - 1
    editor.focus()
    editor.setSelectionRange(start, start)
    editor.scrollTo({ top: Math.max(0, lineCount * lineHeight - lineHeight * 2), behavior: 'smooth' })
  })
}

async function openCreateProjectDialog() {
  if (!selectedTask.value) return
  createProjectTitle.value = selectedTask.value.originalFilename.replace(/\.[^.]+$/, '')
  createProjectAspectRatio.value = '9:16'
  createProjectScriptParseMode.value = selectedScriptParseMode.value
  createProjectStyleId.value = ''
  createProjectDialogOpen.value = true

  if (isOriginExplainerTask.value) return

  await loadStylePresets()
  ensureCreateProjectStyleId()
}

function applyRoleNaming() {
  const validMappings = roleNamingDraft.value
    .map(item => ({
      id: item.id,
      currentLabel: item.currentLabel,
      name: item.name.trim(),
      source: item.source,
      legacyPlaceholder: item.legacyPlaceholder
    }))
    .filter(item => item.name)
  if (validMappings.length === 0) {
    roleNamingDialogOpen.value = false
    return
  }
  scriptDraft.value = applyVideoImportRoleRenames(scriptDraft.value, validMappings)
  roleNamingDialogOpen.value = false
}

async function handleDeleteTask(taskId: string) {
  if (!confirm('确定要删除这个任务吗？此操作无法撤销。')) return
  await deleteTask(taskId)
}
</script>

<template>
  <AppPage>
    <AppPageHeader compact>
      <div class="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-2 shrink-0 gap-2"
          @click="router.push('/import/video')"
        >
          <ArrowLeft class="h-4 w-4" />
          返回任务列表
        </Button>
        <h1 class="min-w-0 truncate text-xl font-semibold tracking-normal">
          {{ selectedTask?.originalFilename || '视频转项目详情' }}
        </h1>
        <span v-if="selectedTask" class="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {{ selectedImportContentLabel }}
          <template v-if="selectedTask.isSeriesGroup && seriesEpisodeStats.total > 0">
            · {{ seriesEpisodeStats.total }} 集
          </template>
        </span>
        <Badge v-if="selectedTask" :variant="statusVariant(selectedTask.status)" class="shrink-0">
          {{ currentStageLabel }}
        </Badge>
      </div>
    </AppPageHeader>

    <AppPageContent
      scroll
      inner-class="flex min-h-full flex-col gap-4"
    >
      <div
        v-if="error"
        class="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        <AlertCircle class="h-4 w-4 shrink-0" />
        {{ error }}
      </div>

      <Card class="flex min-h-0 flex-1 flex-col overflow-visible border-border/70 shadow-none">
        <CardHeader v-if="selectedTask" class="rounded-t-lg border-b bg-muted/10 px-4 py-2.5">
          <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <span>任务进度</span>
              <span class="rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-semibold tabular-nums text-primary">
                {{ currentWorkflowStepNumber }}/{{ workflowSteps.length }}
              </span>
            </div>

            <ol class="grid min-w-0 flex-1 grid-cols-5" aria-label="任务进度">
              <li
                v-for="(step, index) in workflowSteps"
                :key="step.label"
                class="relative flex min-w-0 items-center justify-center gap-1.5 px-1 text-center"
              >
                <div
                  v-if="index > 0"
                  class="absolute right-1/2 top-1/2 h-px w-full"
                  :class="step.state === 'upcoming' ? 'bg-border' : 'bg-primary/60'"
                />
                <span
                  class="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors"
                  :class="{
                    'border-primary bg-primary text-primary-foreground': step.state === 'complete',
                    'border-primary bg-background text-primary ring-4 ring-primary/10': step.state === 'current',
                    'border-destructive bg-destructive text-destructive-foreground': step.state === 'failed',
                    'border-border bg-background text-muted-foreground': step.state === 'upcoming'
                  }"
                >
                  {{ step.state === 'complete' ? '✓' : index + 1 }}
                </span>
                <span
                  class="relative z-10 hidden truncate bg-card/90 px-1 text-[11px] sm:inline"
                  :class="['current', 'failed'].includes(step.state) ? 'font-semibold text-foreground' : 'text-muted-foreground'"
                >
                  {{ step.label }}
                </span>
              </li>
            </ol>

            <div class="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <template v-if="selectedTask.isSeriesGroup && seriesEpisodeStats.total > 0">
                <span>已就绪 <b class="font-semibold tabular-nums text-foreground">{{ seriesEpisodeStats.done }}</b></span>
                <span>处理中 <b class="font-semibold tabular-nums text-foreground">{{ seriesEpisodeStats.running }}</b></span>
                <span :class="seriesEpisodeStats.failed > 0 ? 'text-destructive' : ''">
                  失败 <b class="font-semibold tabular-nums">{{ seriesEpisodeStats.failed }}</b>
                </span>
              </template>
              <Button
                v-if="canCancel"
                variant="outline"
                size="sm"
                class="gap-2"
                :disabled="acting"
                @click="handleCancel"
              >
                <Ban class="h-4 w-4" />
                取消
              </Button>
              <Button
                v-if="selectedTask.status === 'failed' && ['extract', 'transcribe'].includes(selectedTask.currentStep)"
                variant="outline"
                size="sm"
                class="gap-2"
                :disabled="acting"
                @click="handleRetry('transcribe')"
              >
                <RotateCcw class="h-4 w-4" />
                重新识别
              </Button>
              <Button
                v-if="selectedTask.status === 'failed' && selectedTask.currentStep === 'generate_script'"
                variant="outline"
                size="sm"
                class="gap-2"
                :disabled="acting"
                @click="handleRetry('generate_script')"
              >
                <RotateCcw class="h-4 w-4" />
                重新生成剧本
              </Button>
              <Button
                v-if="selectedTask.status === 'failed' && selectedTask.currentStep === 'import'"
                variant="outline"
                size="sm"
                class="gap-2"
                :disabled="acting"
                @click="handleRetry('import')"
              >
                <RotateCcw class="h-4 w-4" />
                重新导入
              </Button>
            </div>
          </div>

          <div v-if="selectedTask?.isSeriesGroup && seriesEpisodes.some(episode => episode.status === 'failed')" class="mt-3 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
            <div class="mb-2 font-medium">失败分集</div>
            <div class="space-y-1">
              <div
                v-for="episode in seriesEpisodes.filter(item => item.status === 'failed')"
                :key="episode.id"
                class="flex items-center gap-2"
              >
                <span class="shrink-0">第{{ episode.episodeNumber || '-' }}集</span>
                <span class="min-w-0 flex-1 truncate">{{ episode.originalFilename }}：{{ friendlyErrorMessage(episode.errorMessage) }}</span>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7 shrink-0 gap-1.5 border-destructive/40 bg-transparent px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  :disabled="acting"
                  @click="handleRetryEpisode(episode.id)"
                >
                  <Loader2 v-if="retryingEpisodeId === episode.id" class="h-3.5 w-3.5 animate-spin" />
                  <RotateCcw v-else class="h-3.5 w-3.5" />
                  {{ retryingEpisodeId === episode.id ? '提交中' : '重新识别' }}
                </Button>
              </div>
            </div>
          </div>

        </CardHeader>

        <CardContent
          v-if="selectedTask"
          class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-0"
        >
          <div class="flex min-h-10 shrink-0 items-end gap-6 border-b" role="tablist" aria-label="任务内容">
            <button
              v-for="tab in contentTabs"
              :key="tab.key"
              type="button"
              role="tab"
              :aria-selected="contentView === tab.key"
              class="relative flex h-10 items-center gap-2 whitespace-nowrap px-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="contentView === tab.key ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="contentView = tab.key"
            >
              {{ tab.label }}
              <Badge v-if="tab.badge" variant="secondary" class="h-5 rounded px-1.5 text-[10px]">
                {{ tab.badge }}
              </Badge>
              <span v-if="contentView === tab.key" class="absolute inset-x-0 bottom-[-1px] h-0.5 bg-primary" />
            </button>
          </div>

          <section v-show="contentView === 'subtitle'" class="flex min-h-0 flex-1 flex-col pt-3" role="tabpanel">
            <div
              class="flex min-h-0 flex-1 flex-col overflow-clip rounded-xl bg-muted/25"
              :class="subtitleHasEpisodeSections ? 'lg:grid lg:grid-cols-[9rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_auto]' : ''"
            >
              <aside
                v-if="subtitleHasEpisodeSections"
                class="max-h-44 overflow-y-auto border-b bg-muted/15 p-2 lg:max-h-none lg:min-h-0 lg:border-b-0 lg:border-r"
                aria-label="分集导航"
              >
                <div class="px-2 pb-1.5 pt-1 text-[11px] font-medium text-muted-foreground">分集</div>
                <button
                  v-for="episode in seriesEpisodes"
                  :key="episode.id"
                  type="button"
                  class="flex h-9 w-full items-center gap-2 rounded border-l-2 px-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="selectedEpisodeNumber === episode.episodeNumber ? 'border-primary bg-muted font-semibold text-foreground' : 'border-transparent text-muted-foreground'"
                  :title="`${episode.originalFilename} · ${episodeStatusLabel(episode.status)}`"
                  @click="locateEpisode(episode.episodeNumber)"
                >
                  <span class="min-w-0 flex-1 truncate">第{{ episode.episodeNumber || '-' }}集</span>
                  <span class="flex h-5 w-5 shrink-0 items-center justify-center" :aria-label="episodeStatusLabel(episode.status)">
                    <Loader2 v-if="runningStatuses.has(episode.status)" class="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
                    <AlertCircle v-else-if="episode.status === 'failed'" class="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                    <Ban v-else-if="episode.status === 'cancelled'" class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    <CheckCircle2 v-else class="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  </span>
                </button>
              </aside>
              <div class="flex min-h-0 min-w-0 flex-1 bg-muted/10">
                <Textarea
                  id="subtitle-editor"
                  v-model="subtitleDraft"
                  class="min-h-[30rem] w-full self-stretch resize-none rounded-none border-0 bg-background px-6 py-5 text-[15px] leading-7 shadow-none focus-visible:ring-2 md:px-10 xl:px-14 2xl:px-16 lg:min-h-0"
                  :class="canEditSubtitle ? '' : 'bg-muted/30'"
                  :disabled="!canEditSubtitle"
                  :placeholder="`识别完成后将显示字幕内容，你可以在此编辑修正。当前视频内容：${selectedImportContentLabel}`"
                />
              </div>
              <footer class="z-20 flex shrink-0 flex-col gap-3 border-t bg-background/95 px-4 py-3 shadow-[0_-8px_24px_hsl(var(--foreground)/0.05)] backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between" :class="subtitleHasEpisodeSections ? 'lg:col-span-2' : ''">
                <div class="text-xs text-muted-foreground">
                  <span v-if="subtitleHasChanges" class="font-medium text-amber-700 dark:text-amber-400">有未保存修改</span>
                  <span v-else>所有修改已保存</span>
                  <span v-if="showSubtitleNextStep"> · 继续时会自动保存</span>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    class="gap-2"
                    :disabled="acting || !subtitleHasChanges || !canEditSubtitle"
                    @click="handleSaveSubtitle"
                  >
                    <Save class="h-4 w-4" />
                    保存修改
                  </Button>
                  <Button
                    v-if="showSubtitleNextStep && primaryAction"
                    size="sm"
                    class="gap-2"
                    :disabled="primaryAction.disabled"
                    @click="primaryAction.action()"
                  >
                    <Loader2 v-if="acting" class="h-4 w-4 animate-spin" />
                    <Wand2 v-else class="h-4 w-4" />
                    {{ acting ? '正在生成...' : primaryAction.label }}
                  </Button>
                </div>
              </footer>
            </div>
          </section>

          <section v-show="contentView === 'script'" class="flex min-h-0 flex-1 flex-col pt-3" role="tabpanel">
            <div
              class="flex min-h-0 flex-1 flex-col overflow-clip rounded-xl bg-muted/25"
              :class="scriptHasEpisodeSections ? 'lg:grid lg:grid-cols-[9rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_auto]' : ''"
            >
              <aside
                v-if="scriptHasEpisodeSections"
                class="max-h-44 overflow-y-auto border-b bg-muted/15 p-2 lg:max-h-none lg:min-h-0 lg:border-b-0 lg:border-r"
                aria-label="分集导航"
              >
                <div class="px-2 pb-1.5 pt-1 text-[11px] font-medium text-muted-foreground">分集</div>
                <button
                  v-for="episode in seriesEpisodes"
                  :key="episode.id"
                  type="button"
                  class="flex h-9 w-full items-center gap-2 rounded border-l-2 px-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="selectedEpisodeNumber === episode.episodeNumber ? 'border-primary bg-muted font-semibold text-foreground' : 'border-transparent text-muted-foreground'"
                  :title="`${episode.originalFilename} · ${episodeStatusLabel(episode.status)}`"
                  @click="locateEpisode(episode.episodeNumber)"
                >
                  <span class="min-w-0 flex-1 truncate">第{{ episode.episodeNumber || '-' }}集</span>
                  <span class="flex h-5 w-5 shrink-0 items-center justify-center" :aria-label="episodeStatusLabel(episode.status)">
                    <Loader2 v-if="runningStatuses.has(episode.status)" class="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
                    <AlertCircle v-else-if="episode.status === 'failed'" class="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                    <Ban v-else-if="episode.status === 'cancelled'" class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    <CheckCircle2 v-else class="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  </span>
                </button>
              </aside>
              <div class="flex min-h-0 min-w-0 flex-1 bg-muted/10">
                <Textarea
                  id="script-editor"
                  v-model="scriptDraft"
                  class="min-h-[30rem] w-full self-stretch resize-none rounded-none border-0 bg-background px-6 py-5 text-[15px] leading-7 shadow-none focus-visible:ring-2 md:px-10 xl:px-14 2xl:px-16 lg:min-h-0"
                  :class="canEditScript ? '' : 'bg-muted/30'"
                  :disabled="!canEditScript"
                  :placeholder="`从字幕生成的${scriptContentLabel}将显示在这里，确认无误后即可创建项目`"
                />
              </div>
              <footer class="z-20 flex shrink-0 flex-col gap-3 border-t bg-background/95 px-4 py-3 shadow-[0_-8px_24px_hsl(var(--foreground)/0.05)] backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between" :class="scriptHasEpisodeSections ? 'lg:col-span-2' : ''">
                <div class="text-xs text-muted-foreground">
                  <span v-if="scriptHasChanges" class="font-medium text-amber-700 dark:text-amber-400">有未保存修改</span>
                  <span v-else>所有修改已保存</span>
                  <span v-if="showScriptNextStep"> · 创建项目时会自动保存</span>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <Button
                    v-if="!isOriginExplainerTask"
                    variant="outline"
                    size="sm"
                    class="gap-2"
                    :disabled="detectedRoleCandidates.length === 0"
                    :title="detectedRoleCandidates.length === 0 ? '当前剧本未检测到可命名的角色条目' : '批量填写或修改角色名称'"
                    @click="handleOpenRoleNamingDialog"
                  >
                    <Pencil class="h-4 w-4" />
                    命名角色
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    class="gap-2"
                    :disabled="acting || !scriptHasChanges || !canEditScript"
                    @click="handleSaveScript"
                  >
                    <Save class="h-4 w-4" />
                    保存修改
                  </Button>
                  <Button
                    v-if="showScriptNextStep && primaryAction"
                    size="sm"
                    class="gap-2"
                    :disabled="primaryAction.disabled"
                    @click="openCreateProjectDialog"
                  >
                    <FolderInput class="h-4 w-4" />
                    {{ primaryAction.label }}
                  </Button>
                </div>
              </footer>
            </div>
          </section>

          <section v-show="contentView === 'logs'" class="flex flex-col gap-4">
            <div class="rounded-md border">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                @click="logsExpanded = !logsExpanded"
              >
                <div class="flex items-center gap-2">
                  <h2 class="text-sm font-medium">执行记录</h2>
                  <Badge v-if="activeTask?.stepRuns?.length" variant="secondary" class="text-xs">
                    {{ activeTask.stepRuns.length }}
                  </Badge>
                </div>
                <span class="text-xs text-muted-foreground">
                  {{ logsExpanded ? '收起' : '展开' }}
                </span>
              </button>
              <div v-show="logsExpanded" class="border-t">
                <div v-if="activeTask?.stepRuns?.length" class="divide-y">
                  <div
                    v-for="run in activeTask.stepRuns"
                    :key="run.id"
                    class="grid gap-3 px-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_110px_120px]"
                  >
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="font-medium">{{ stepLabel(run.step) }}</span>
                        <Badge :variant="runStatusVariant(run.status)" class="text-xs">
                          {{ runStatusLabel(run.status) }}
                        </Badge>
                        <span v-if="run.attempt > 1" class="text-xs text-muted-foreground">
                          第 {{ run.attempt }} 次
                        </span>
                      </div>
                      <div class="mt-1 text-xs text-muted-foreground">
                        {{ formatDate(run.startedAt) }}
                        <template v-if="run.provider">
                          · {{ run.provider }}
                        </template>
                        <template v-if="run.externalTaskId">
                          · 外部任务 {{ run.externalTaskId }}
                        </template>
                      </div>
                      <div
                        v-if="run.errorMessage"
                        class="mt-2 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                      >
                        {{ friendlyErrorMessage(run.errorMessage) }}
                      </div>
                    </div>
                    <div class="text-xs text-muted-foreground md:text-right">
                      {{ formatDuration(run.durationMs) }}
                    </div>
                    <div class="text-xs text-muted-foreground md:text-right">
                      {{ run.endedAt ? formatDate(run.endedAt) : '未结束' }}
                    </div>
                  </div>
                </div>
                <div v-else class="px-3 py-8 text-center text-sm text-muted-foreground">
                  暂无执行记录
                </div>
              </div>
            </div>

            <div class="rounded-md border">
              <div class="border-b px-3 py-2">
                <h2 class="text-sm font-medium">产物文件</h2>
              </div>
              <div v-if="activeTask?.artifacts?.length" class="divide-y">
                <div
                  v-for="artifact in activeTask.artifacts"
                  :key="artifact.id"
                  class="px-3 py-3 text-sm"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="font-medium">{{ artifactKindLabel(artifact.kind) }}</div>
                      <button
                        type="button"
                        class="mt-1 block truncate text-left text-xs text-primary underline-offset-2 hover:underline"
                        :title="artifact.path"
                        @click="handleOpenArtifactPath(artifact.path)"
                      >
                        {{ artifact.path }}
                      </button>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <span class="text-xs text-muted-foreground">
                        {{ formatBytes(artifact.sizeBytes) }}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        class="h-7 px-2 text-xs"
                        @click="handleOpenArtifactPath(artifact.path)"
                      >
                        打开
                      </Button>
                    </div>
                  </div>
                  <div class="mt-1 text-xs text-muted-foreground">
                    {{ formatDate(artifact.createdAt) }}
                  </div>
                </div>
              </div>
              <div v-else class="px-3 py-8 text-center text-sm text-muted-foreground">
                暂无产物文件
              </div>
            </div>
          </section>

          <div>
            <div
              v-if="selectedTask.status === 'imported'"
              class="flex items-center justify-between gap-3 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"
            >
              <div class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 shrink-0" />
                <span>项目创建成功！</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                class="gap-2 border-emerald-500/30 hover:bg-emerald-500/20"
                @click="router.push('/projects')"
              >
                <FolderInput class="h-4 w-4" />
                查看项目
              </Button>
            </div>
            <div
              v-else-if="selectedTask.errorMessage"
              class="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
              <span>{{ selectedTask.errorMessage }}</span>
            </div>
          </div>
        </CardContent>

        <CardContent
          v-else
          class="flex h-[420px] flex-col items-center justify-center gap-4 text-center text-sm text-muted-foreground"
        >
          <FileVideo class="h-16 w-16 opacity-20" />
          <div class="space-y-2">
            <div class="text-base font-medium text-foreground">暂未选择任务</div>
            <div class="text-muted-foreground">
              返回任务列表开始第一个转换任务
            </div>
          </div>
          <Button variant="outline" class="gap-2 mt-2" @click="router.push('/import/video')">
            <ArrowLeft class="h-4 w-4" />
            返回任务列表
          </Button>
        </CardContent>
      </Card>
    </AppPageContent>

    <Dialog
      :open="roleNamingDialogOpen"
      @update:open="roleNamingDialogOpen = $event"
    >
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>命名角色</DialogTitle>
          <DialogDescription>
            为角色填写或修改名称，确认后会同步更新角色清单和当前剧本引用。
          </DialogDescription>
        </DialogHeader>

        <div class="max-h-[min(60vh,32rem)] space-y-3 overflow-y-auto py-1 pr-1">
          <div
            v-for="item in roleNamingDraft"
            :key="item.id"
            class="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] items-center gap-3"
          >
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-foreground" :title="item.currentLabel">
                {{ item.currentLabel }}
              </div>
              <div class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {{ item.aliases.length > 0 ? `别名：${item.aliases.join('、')}` : '暂无别名' }}
              </div>
            </div>
            <Input
              v-model="item.name"
              :placeholder="`输入${item.currentLabel}的真实名称`"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            @click="roleNamingDialogOpen = false"
          >
            取消
          </Button>
          <Button @click="applyRoleNaming">
            应用名称
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      :open="createProjectDialogOpen"
      @update:open="createProjectDialogOpen = $event"
    >
      <DialogContent class="flex max-h-[90vh] flex-col sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>创建项目</DialogTitle>
          <DialogDescription>
            {{ isOriginExplainerTask
              ? '确认项目名称和画幅后，按科普拆解方式创建项目。'
              : '确认项目名称、画幅和画风后创建项目。' }}
          </DialogDescription>
        </DialogHeader>

        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto py-1 pr-1">
          <Input
            v-model="createProjectTitle"
            placeholder="项目标题（选填）"
          />

          <div class="grid gap-1.5">
            <label class="text-xs font-medium text-muted-foreground">画幅</label>
            <Select v-model="createProjectAspectRatio">
              <SelectTrigger class="bg-background">
                <SelectValue placeholder="画幅" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="9:16">竖屏 9:16</SelectItem>
                <SelectItem value="16:9">横屏 16:9</SelectItem>
                <SelectItem value="1:1">方形 1:1</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div v-if="!isOriginExplainerTask" class="grid gap-2">
            <div>
              <div class="text-sm font-medium text-foreground">项目画风</div>
              <div class="mt-0.5 text-xs text-muted-foreground">
                该画风将用于后续角色、环境和分镜视频生成。
              </div>
            </div>
            <div
              v-if="styleConfigLoading && availableStylePresets.length === 0"
              class="flex min-h-32 items-center justify-center text-sm text-muted-foreground"
            >
              <Loader2 class="mr-2 h-4 w-4 animate-spin" />
              加载画风配置中...
            </div>
            <div
              v-else-if="availableStylePresets.length === 0"
              class="rounded-xl bg-destructive/10 px-3 py-3 text-sm text-destructive"
            >
              {{ styleConfigError || '没有可用画风，请先在设置中启用画风预设。' }}
            </div>
            <StyleSelector
              v-else
              v-model="createProjectStyleId"
              :styles="availableStylePresets"
              :categories="availableStyleCategories"
              :default-style-id="defaultStyleId"
              :show-search="true"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="createProjectDialogOpen = false">
            取消
          </Button>
          <Button
            :disabled="acting || (!isOriginExplainerTask && !createProjectStyleId)"
            @click="handleImport"
          >
            <Loader2
              v-if="acting"
              class="mr-2 h-4 w-4 animate-spin"
            />
            {{ acting ? '正在创建...' : '确认并创建项目' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </AppPage>
</template>
