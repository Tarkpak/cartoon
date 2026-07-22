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
  normalizeScriptParseMode,
  resolveScriptParseModeLabel,
  type ScriptParseMode
} from '#shared/types/script'
import { projectScriptParseModeOptions } from '~/lib/projects-page'
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
const roleNamingDraft = ref<Array<{ placeholder: string, name: string }>>([])
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
const selectedScriptParseMode = computed<ScriptParseMode>(() => {
  return normalizeScriptParseMode(selectedTask.value?.config?.scriptParseMode)
})
const isOriginExplainerTask = computed(() => selectedScriptParseMode.value === 'origin_explainer')
const selectedImportContentLabel = computed(() => isOriginExplainerTask.value ? '科普内容' : '剧情内容')
const selectedImportContentDescription = computed(() => {
  return isOriginExplainerTask.value
    ? '字幕将整理为科普主题输入稿，并按科普拆解方式创建项目。'
    : '字幕将整理为剧情剧本，并按精品剧方式创建项目。'
})
const createProjectScriptParseModeOptions = computed(() => {
  if (isOriginExplainerTask.value) {
    return projectScriptParseModeOptions.filter(option => option.value === 'origin_explainer')
  }
  return projectScriptParseModeOptions.filter(option => option.value !== 'origin_explainer')
})

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
  return isOriginExplainerTask.value ? '用当前字幕生成科普脚本' : '用当前字幕生成剧本'
})
const subtitleNextStepText = computed(() => {
  return isOriginExplainerTask.value
    ? '确认字幕后，将生成适合科普拆解的多镜头脚本。'
    : '确认字幕后，将生成可编辑的剧本草稿。'
})
const scriptNextStepText = computed(() => {
  return isOriginExplainerTask.value
    ? '确认科普脚本后，将创建项目并进入镜头规划。'
    : '确认剧本后，将创建项目并进入剧本解析。'
})
const seriesEpisodeStats = computed(() => {
  const episodes = seriesEpisodes.value
  const total = episodes.length
  const failed = episodes.filter(task => task.status === 'failed').length
  const done = episodes.filter(task => ['subtitle_ready', 'script_ready', 'importing', 'imported'].includes(task.status)).length
  const running = episodes.filter(task => runningStatuses.has(task.status)).length
  return { total, failed, done, running }
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
const detectedRolePlaceholders = computed(() => {
  const text = scriptDraft.value || activeTask.value?.scriptText || ''
  const matches = new Set<string>()
  const patterns = [
    /角色\s*([A-Z])(?=\b|[：:，。、！？\s]|$)/g,
    /(?:^|\n)\s*([A-Z])(?=\s*[：:])/g
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]?.trim()
      if (value) matches.add(value)
    }
  }
  return Array.from(matches).sort()
})

function normalizeScriptForEditing(text: string) {
  return text
    .replace(/^##\s*角色[\s\S]*?(?=^##\s|\Z)/m, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

watch(activeTask, (value) => {
  subtitleDraft.value = value?.subtitleText || ''
  scriptDraft.value = normalizeScriptForEditing(value?.scriptText || '')
  if (value?.task.status === 'script_ready') {
    contentView.value = 'script'
  } else if (value?.task.status === 'subtitle_ready') {
    contentView.value = 'subtitle'
  }
})

watch(roleNamingDialogOpen, (open) => {
  if (!open) return
  roleNamingDraft.value = detectedRolePlaceholders.value.map((placeholder) => ({
    placeholder,
    name: ''
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

function replaceRolePlaceholders(input: string, replacements: Array<{ placeholder: string, name: string }>) {
  let output = input
  for (const replacement of replacements) {
    const placeholder = replacement.placeholder.trim()
    const name = replacement.name.trim()
    if (!placeholder || !name) continue
    output = output.replace(new RegExp(`角色\\s*${placeholder}(?=\\b|[：:，。、！？\\s]|$)`, 'g'), name)
    output = output.replace(new RegExp(`(^|\\n)(\\s*)${placeholder}(?=\\s*[：:])`, 'g'), `$1$2${name}`)
  }
  return output
}

function handleOpenRoleNamingDialog() {
  if (detectedRolePlaceholders.value.length === 0) return
  roleNamingDialogOpen.value = true
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
    .map(item => ({ placeholder: item.placeholder, name: item.name.trim() }))
    .filter(item => item.name)
  if (validMappings.length === 0) {
    roleNamingDialogOpen.value = false
    return
  }
  scriptDraft.value = replaceRolePlaceholders(scriptDraft.value, validMappings)
  roleNamingDialogOpen.value = false
}

async function handleDeleteTask(taskId: string) {
  if (!confirm('确定要删除这个任务吗？此操作无法撤销。')) return
  await deleteTask(taskId)
}
</script>

<template>
  <AppPage>
    <AppPageHeader>
      <div class="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-2 gap-2"
          @click="router.push('/import/video')"
        >
          <ArrowLeft class="h-4 w-4" />
          返回任务列表
        </Button>
        <h1 class="truncate text-xl font-semibold tracking-normal">
          {{ selectedTask?.originalFilename || '视频转项目详情' }}
        </h1>
        <Badge v-if="selectedTask" variant="secondary" class="shrink-0">
          {{ selectedImportContentLabel }}
        </Badge>
        <Badge v-if="selectedTask" :variant="statusVariant(selectedTask.status)" class="shrink-0">
          {{ currentStageLabel }}
        </Badge>
      </div>
    </AppPageHeader>

    <AppPageContent
      scroll
      inner-class="flex flex-col gap-4"
    >
      <div
        v-if="error"
        class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        <AlertCircle class="h-4 w-4 shrink-0" />
        {{ error }}
      </div>

      <Card class="flex flex-col overflow-hidden">
        <CardHeader class="border-b pb-3">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="min-w-0">
              <div v-if="selectedTask" class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{{ currentStageLabel }}</span>
                <template v-if="selectedTask.status !== 'imported' && selectedTask.status !== 'failed' && selectedTask.status !== 'cancelled'">
                  <span class="text-border">/</span>
                  <span>完成度 {{ selectedTask.progress }}%</span>
                </template>
              </div>
            </div>
            <div
              v-if="selectedTask"
              class="flex flex-wrap gap-2"
            >
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

          <div
            v-if="selectedTask"
            class="mt-4 flex flex-col gap-2 rounded-md border bg-muted/20 px-3 py-2.5 text-sm lg:flex-row lg:items-center lg:justify-between"
          >
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant="secondary" class="shrink-0">
                {{ selectedImportContentLabel }}
              </Badge>
              <span class="truncate text-muted-foreground">
                {{ selectedImportContentDescription }}
              </span>
            </div>
            <div class="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{{ currentStageLabel }}</span>
              <span class="text-border">/</span>
              <span v-if="showSubtitleNextStep">{{ generateScriptActionLabel }}</span>
              <span v-else-if="showScriptNextStep">确认并创建项目</span>
              <span v-else>{{ selectedTask.progress }}%</span>
            </div>
          </div>

          <div v-if="selectedTask?.isSeriesGroup && seriesEpisodeStats.total > 0" class="mt-4 grid gap-2 rounded-md border bg-muted/30 p-3 text-xs md:grid-cols-4">
            <div>
              <div class="text-muted-foreground">分集数量</div>
              <div class="mt-1 font-medium text-foreground">{{ seriesEpisodeStats.total }} 集</div>
            </div>
            <div>
              <div class="text-muted-foreground">字幕就绪</div>
              <div class="mt-1 font-medium text-foreground">{{ seriesEpisodeStats.done }} 集</div>
            </div>
            <div>
              <div class="text-muted-foreground">处理中</div>
              <div class="mt-1 font-medium text-foreground">{{ seriesEpisodeStats.running }} 集</div>
            </div>
            <div>
              <div class="text-muted-foreground">失败</div>
              <div class="mt-1 font-medium" :class="seriesEpisodeStats.failed > 0 ? 'text-destructive' : 'text-foreground'">
                {{ seriesEpisodeStats.failed }} 集
              </div>
            </div>
          </div>

          <div v-if="selectedTask?.isSeriesGroup && seriesEpisodes.some(episode => episode.status === 'failed')" class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <div class="mb-2 font-medium">失败分集</div>
            <div class="space-y-1">
              <div
                v-for="episode in seriesEpisodes.filter(item => item.status === 'failed')"
                :key="episode.id"
                class="flex gap-2"
              >
                <span class="shrink-0">第{{ episode.episodeNumber || '-' }}集</span>
                <span class="min-w-0 truncate">{{ episode.originalFilename }}：{{ friendlyErrorMessage(episode.errorMessage) }}</span>
              </div>
            </div>
          </div>

        </CardHeader>

        <CardContent
          v-if="selectedTask"
          class="flex min-h-0 flex-1 flex-col gap-4 p-4"
        >
          <div class="flex flex-wrap gap-2 border-b pb-3">
            <Button
              v-for="tab in contentTabs"
              :key="tab.key"
              variant="ghost"
              size="sm"
              class="gap-2"
              :class="contentView === tab.key ? 'bg-muted' : ''"
              @click="contentView = tab.key"
            >
              {{ tab.label }}
              <Badge v-if="tab.badge" variant="secondary" class="text-xs">
                {{ tab.badge }}
              </Badge>
            </Button>
          </div>

          <section v-show="contentView === 'subtitle'" class="flex flex-1 flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-sm font-medium text-muted-foreground">
                  字幕内容
                  <span v-if="!canEditSubtitle" class="ml-2 text-xs">(只读)</span>
                </h2>
                <p v-if="showSubtitleNextStep" class="mt-1 text-xs text-muted-foreground">
                  {{ subtitleNextStepText }}
                </p>
              </div>
              <div class="flex gap-2">
                <Button
                  v-if="subtitleHasChanges && canEditSubtitle"
                  variant="outline"
                  size="sm"
                  class="gap-2"
                  :disabled="acting"
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
                  <Wand2 class="h-4 w-4" />
                  {{ primaryAction.label }}
                </Button>
              </div>
            </div>
            <div class="relative flex-1">
              <Textarea
                v-model="subtitleDraft"
                class="min-h-[420px] w-full resize-y rounded-md border font-mono text-sm leading-6"
                :class="canEditSubtitle ? 'border-primary/50 ring-1 ring-primary/20' : 'bg-muted/30'"
                :disabled="!canEditSubtitle"
                :placeholder="`识别完成后将显示字幕内容，你可以在此编辑修正。当前视频内容：${selectedImportContentLabel}`"
              />
            </div>
          </section>

          <section v-show="contentView === 'script'" class="flex flex-1 flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-sm font-medium text-muted-foreground">
                  {{ scriptContentLabel }}内容
                  <span v-if="!canEditScript" class="ml-2 text-xs">(只读)</span>
                </h2>
                <p v-if="showScriptNextStep" class="mt-1 text-xs text-muted-foreground">
                  {{ scriptNextStepText }}
                </p>
              </div>
              <div class="flex gap-2">
                <Button
                  v-if="detectedRolePlaceholders.length > 0"
                  variant="outline"
                  size="sm"
                  class="gap-2"
                  @click="handleOpenRoleNamingDialog"
                >
                  <Pencil class="h-4 w-4" />
                  命名角色
                </Button>
                <Button
                  v-if="scriptHasChanges && canEditScript"
                  variant="outline"
                  size="sm"
                  class="gap-2"
                  :disabled="acting"
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
            </div>
            <div class="relative flex-1">
              <Textarea
                v-model="scriptDraft"
                class="min-h-[520px] w-full resize-y rounded-md border font-mono text-sm leading-6"
                :class="canEditScript ? 'border-primary/50 ring-1 ring-primary/20' : 'bg-muted/30'"
                :disabled="!canEditScript"
                :placeholder="`从字幕生成的${scriptContentLabel}将显示在这里，确认无误后即可创建项目`"
              />
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
              class="flex items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"
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
              class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
            为剧本中的占位角色批量填写真实名称，确认后会直接替换当前剧本草稿。
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3 py-1">
          <div
            v-for="item in roleNamingDraft"
            :key="item.placeholder"
            class="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3"
          >
            <div class="text-sm font-medium text-foreground">
              角色{{ item.placeholder }}
            </div>
            <Input
              v-model="item.name"
              :placeholder="`输入角色${item.placeholder}的名字`"
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
              : '确认项目名称、画幅和解析方式后创建项目。' }}
          </DialogDescription>
        </DialogHeader>

        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto py-1 pr-1">
          <Input
            v-model="createProjectTitle"
            placeholder="项目标题（选填）"
          />

          <div class="rounded-md border bg-muted/25 p-3">
            <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
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

              <div class="grid gap-1.5 sm:min-w-[160px]">
                <label class="text-xs font-medium text-muted-foreground">项目解析方式</label>
                <Select
                  v-if="!isOriginExplainerTask"
                  v-model="createProjectScriptParseMode"
                >
                  <SelectTrigger class="bg-background">
                    <SelectValue placeholder="解析方式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="option in createProjectScriptParseModeOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div
                  v-else
                  class="flex h-10 items-center rounded-md border bg-background px-3 text-sm font-medium text-foreground"
                >
                  {{ resolveScriptParseModeLabel(createProjectScriptParseMode) }}
                </div>
              </div>
            </div>
            <div class="mt-2 text-xs leading-5 text-muted-foreground">
              {{ projectScriptParseModeOptions.find(option => option.value === createProjectScriptParseMode)?.description }}
            </div>
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
              class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive"
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
