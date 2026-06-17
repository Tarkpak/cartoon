<script setup lang="ts">
import {
  ArrowLeft,
  FileVideo,
  RefreshCw,
  Upload,
  Wand2,
  Save,
  RotateCcw,
  Ban,
  FolderInput,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Trash2
} from 'lucide-vue-next'
import { useVideoImport, type VideoImportConfig, type VideoImportRetryStep, type VideoImportSeriesPreview } from '@/composables/useVideoImport'

definePageMeta({
  layout: 'default'
})

const router = useRouter()
const route = useRoute()
const {
  tasks,
  activeTask,
  loading,
  uploading,
  acting,
  error,
  fetchTasks,
  fetchTask,
  uploadVideo,
  uploadSeriesFolder,
  previewSeriesFolder,
  updateSubtitle,
  generateScript,
  updateScript,
  importToProject,
  retryTask,
  cancelTask,
  deleteTask,
  deleteTasks
} = useVideoImport()

const fileInputKey = ref(0)
const selectedFile = ref<File | null>(null)
const selectedFolder = ref<string | null>(null)
const selectedSeriesPreview = ref<VideoImportSeriesPreview | null>(null)
const previewingSeriesFolder = ref(false)
const uploadMode = ref<'single' | 'series'>('single')
const projectTitle = ref('')
const aspectRatio = ref<'16:9' | '9:16' | '1:1'>('9:16')
const scriptParseMode = ref<'short_drama' | 'premium_drama'>('short_drama')
const subtitleDraft = ref('')
const scriptDraft = ref('')
const sidebarCollapsed = ref(false)
const contentView = ref<'subtitle' | 'script' | 'logs'>('subtitle')
const selectedTaskIds = ref<Set<string>>(new Set())
const showBatchActions = ref(false)
let refreshTimer: number | null = null
const routeTaskId = computed(() => {
  const raw = route.params.id
  return typeof raw === 'string' ? raw.trim() : ''
})

const runningStatuses = new Set(['pending', 'extracting', 'transcribing', 'generating_script', 'importing'])

const hasRunningTasks = computed(() => tasks.value.some(task => runningStatuses.has(task.status)))
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
const failedTasks = computed(() => tasks.value.filter(task => task.status === 'failed' || task.status === 'cancelled'))
const completedTasks = computed(() => tasks.value.filter(task => task.status === 'imported'))
const hasSelection = computed(() => selectedTaskIds.value.size > 0)
const allTasksSelected = computed(() => tasks.value.length > 0 && selectedTaskIds.value.size === tasks.value.length)
const seriesEpisodes = computed(() => activeTask.value?.episodes || [])
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
      label: '用当前字幕生成剧本',
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
const workflowSteps = computed(() => {
  const task = selectedTask.value
  if (!task) return []
  const current = getCurrentStepIndex(task.status)
  return [
    { label: '导入视频', done: current >= 1, active: current <= 2 && runningStatuses.has(task.status) },
    { label: '识别字幕', done: current >= 3, active: current < 3 && runningStatuses.has(task.status) },
    { label: '确认字幕', done: current >= 4, active: task.status === 'subtitle_ready' },
    { label: '生成剧本', done: current >= 5, active: task.status === 'generating_script' },
    { label: '创建项目', done: current >= 7, active: ['script_ready', 'importing'].includes(task.status) }
  ]
})

watch(activeTask, (value) => {
  subtitleDraft.value = value?.subtitleText || ''
  scriptDraft.value = value?.scriptText || ''
  if (value?.task.status === 'script_ready') {
    contentView.value = 'script'
  } else if (value?.task.status === 'subtitle_ready') {
    contentView.value = 'subtitle'
  }
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
  await fetchTasks()
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
      void fetchTasks()
    }, 2500)
  }
  if (!running && refreshTimer) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] || null
  if (!projectTitle.value && selectedFile.value) {
    projectTitle.value = selectedFile.value.name.replace(/\.[^.]+$/, '')
  }
}

async function handleSelectFolder() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择剧集文件夹'
    })

    if (selected && typeof selected === 'string') {
      selectedFolder.value = selected
      selectedSeriesPreview.value = null
      if (!projectTitle.value) {
        const folderName = selected.split(/[/\\]/).pop() || '未命名剧集'
        projectTitle.value = folderName
      }
      previewingSeriesFolder.value = true
      try {
        selectedSeriesPreview.value = await previewSeriesFolder(selected)
      } finally {
        previewingSeriesFolder.value = false
      }
    }
  } catch (err) {
    console.error('Failed to open folder dialog:', err)
    if (!selectedFolder.value) {
      window.alert('当前环境无法打开文件夹选择器，请在桌面端使用整部剧导入。')
    }
  }
}

async function handleUpload() {
  if (uploadMode.value === 'single') {
    if (!selectedFile.value) return
    const config: VideoImportConfig = {
      projectTitle: projectTitle.value.trim() || undefined,
      aspectRatio: aspectRatio.value,
      scriptParseMode: scriptParseMode.value
    }
    const taskId = await uploadVideo(selectedFile.value, config)
    selectedFile.value = null
    fileInputKey.value += 1
    await router.push(`/import/video/${taskId}`)
  } else {
    if (!selectedFolder.value) return
    const config: VideoImportConfig = {
      projectTitle: projectTitle.value.trim() || undefined,
      aspectRatio: aspectRatio.value,
      scriptParseMode: scriptParseMode.value
    }
    const result = await uploadSeriesFolder(selectedFolder.value, config)
    selectedFolder.value = null
    selectedSeriesPreview.value = null
    await router.push(`/import/video/${result.seriesId}`)
  }
}

function setUploadMode(mode: 'single' | 'series') {
  uploadMode.value = mode
  if (mode === 'single') {
    selectedFolder.value = null
    selectedSeriesPreview.value = null
  } else {
    selectedFile.value = null
  }
}

async function handleTaskSelect(taskId: string) {
  if (taskId !== routeTaskId.value) {
    await router.push(`/import/video/${taskId}`)
    return
  }
  await fetchTask(taskId)
}

async function handleRefresh() {
  await fetchTasks()
  if (routeTaskId.value) {
    await fetchTask(routeTaskId.value)
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
  if (scriptHasChanges.value) {
    await updateScript(selectedTask.value.id, scriptDraft.value)
  }
  const result = await importToProject(selectedTask.value.id)
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

function getCurrentStepIndex(status: string): number {
  const steps = ['pending', 'extracting', 'transcribing', 'subtitle_ready', 'generating_script', 'script_ready', 'importing', 'imported']
  const index = steps.indexOf(status)
  return index >= 0 ? index : 0
}

function isStepActive(status: string, stepIndex: number): boolean {
  return getCurrentStepIndex(status) >= stepIndex
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

function formatDateRelative(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return date.toLocaleDateString()
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return ''
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function toggleTaskSelection(taskId: string) {
  if (selectedTaskIds.value.has(taskId)) {
    selectedTaskIds.value.delete(taskId)
  } else {
    selectedTaskIds.value.add(taskId)
  }
}

function toggleAllTasks() {
  if (allTasksSelected.value) {
    selectedTaskIds.value.clear()
  } else {
    tasks.value.forEach(task => selectedTaskIds.value.add(task.id))
  }
}

async function handleDeleteSelected() {
  if (!hasSelection.value) return
  const count = selectedTaskIds.value.size
  if (!confirm(`确定要删除选中的 ${count} 个任务吗？此操作无法撤销。`)) return
  await deleteTasks(Array.from(selectedTaskIds.value))
  selectedTaskIds.value.clear()
  showBatchActions.value = false
}

async function handleDeleteFailed() {
  if (failedTasks.value.length === 0) return
  if (!confirm(`确定要删除所有失败的任务吗？共 ${failedTasks.value.length} 个任务，此操作无法撤销。`)) return
  await deleteTasks(failedTasks.value.map(t => t.id))
  showBatchActions.value = false
}

async function handleDeleteCompleted() {
  if (completedTasks.value.length === 0) return
  if (!confirm(`确定要删除所有已完成的任务吗？共 ${completedTasks.value.length} 个任务，此操作无法撤销。`)) return
  await deleteTasks(completedTasks.value.map(t => t.id))
  showBatchActions.value = false
}

async function handleDeleteTask(taskId: string) {
  if (!confirm('确定要删除这个任务吗？此操作无法撤销。')) return
  await deleteTask(taskId)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4 md:p-6">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div class="mb-2">
          <Button
            variant="ghost"
            size="sm"
            class="-ml-2 gap-2"
            @click="router.push('/import/video')"
          >
            <ArrowLeft class="h-4 w-4" />
            返回任务列表
          </Button>
        </div>
        <h1 class="text-2xl font-semibold tracking-normal">
          {{ selectedTask?.originalFilename || '视频转项目详情' }}
        </h1>
        <p class="text-sm text-muted-foreground">
          确认字幕和剧本，完成后创建项目
        </p>
      </div>
      <Button
        variant="outline"
        class="gap-2"
        :disabled="loading"
        @click="handleRefresh"
      >
        <RefreshCw
          class="h-4 w-4"
          :class="loading ? 'animate-spin' : ''"
        />
        刷新
      </Button>
    </div>

    <div
      v-if="error"
      class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertCircle class="h-4 w-4 shrink-0" />
      {{ error }}
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)]">
      <div
        class="flex min-h-0 gap-4 transition-all"
        :class="sidebarCollapsed ? 'xl:grid-cols-[80px_minmax(0,1fr)]' : 'xl:grid-cols-[390px_minmax(0,1fr)]'"
        style="display: grid;"
      >
        <div class="flex min-h-0 flex-col gap-4">
          <Button
            variant="outline"
            size="sm"
            class="hidden gap-2 xl:flex"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <ChevronLeft v-if="!sidebarCollapsed" class="h-4 w-4" />
            <ChevronRight v-if="sidebarCollapsed" class="h-4 w-4" />
            <span v-if="!sidebarCollapsed">收起侧边栏</span>
            <span v-else>展开侧边栏</span>
          </Button>

          <Card v-if="false" class="shrink-0">
          <CardHeader class="pb-3">
            <CardTitle class="flex items-center gap-2 text-base">
              <Upload class="h-4 w-4" />
              上传视频
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <div class="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                class="flex-1"
                :class="uploadMode === 'single' ? 'bg-muted' : ''"
                @click="setUploadMode('single')"
              >
                单集
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="flex-1"
                :class="uploadMode === 'series' ? 'bg-muted' : ''"
                @click="setUploadMode('series')"
              >
                整部剧
              </Button>
            </div>

            <div v-if="uploadMode === 'single'">
              <Input
                :key="fileInputKey"
                type="file"
                accept="video/*"
                @change="handleFileChange"
              />
            </div>

            <div v-else class="space-y-2">
              <Button
                variant="outline"
                class="w-full justify-start"
                @click="handleSelectFolder"
              >
                <FolderInput class="mr-2 h-4 w-4" />
                {{ selectedFolder ? '重新选择文件夹' : '选择剧集文件夹' }}
              </Button>
              <div v-if="selectedFolder" class="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                <div class="break-all text-muted-foreground">
                  {{ selectedFolder }}
                </div>
                <div v-if="previewingSeriesFolder" class="mt-2 text-muted-foreground">
                  正在检查剧集文件...
                </div>
                <div v-else-if="selectedSeriesPreview" class="mt-2 space-y-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-medium text-foreground">
                      识别到 {{ selectedSeriesPreview?.episodeCount || 0 }} 个视频
                    </span>
                    <span class="text-muted-foreground">按文件名数字顺序导入</span>
                  </div>
                  <div class="max-h-36 overflow-y-auto rounded border bg-background">
                    <div
                      v-for="file in selectedSeriesPreview?.files.slice(0, 12) || []"
                      :key="file.path"
                      class="flex items-center justify-between gap-2 border-b px-2 py-1.5 last:border-b-0"
                    >
                      <span class="min-w-0 truncate">
                        第{{ file.episodeNumber }}集 · {{ file.filename }}
                      </span>
                      <span class="shrink-0 text-muted-foreground">
                        {{ formatBytes(file.sizeBytes) }}
                      </span>
                    </div>
                    <div
                      v-if="(selectedSeriesPreview?.files.length || 0) > 12"
                      class="px-2 py-1.5 text-muted-foreground"
                    >
                      还有 {{ (selectedSeriesPreview?.files.length || 0) - 12 }} 个视频将按同样顺序导入
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Input
              v-model="projectTitle"
              placeholder="项目标题（选填）"
            />
            <div class="grid grid-cols-2 gap-2">
              <Select v-model="aspectRatio">
                <SelectTrigger>
                  <SelectValue placeholder="画幅" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">
                    竖屏 9:16
                  </SelectItem>
                  <SelectItem value="16:9">
                    横屏 16:9
                  </SelectItem>
                  <SelectItem value="1:1">
                    方形 1:1
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select v-model="scriptParseMode">
                <SelectTrigger>
                  <SelectValue placeholder="剧本类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short_drama">
                    短剧
                  </SelectItem>
                  <SelectItem value="premium_drama">
                    精品剧
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              class="w-full gap-2"
              :disabled="(uploadMode === 'single' ? !selectedFile : !selectedFolder || previewingSeriesFolder || !selectedSeriesPreview?.episodeCount) || uploading"
              @click="handleUpload"
            >
              <Upload class="h-4 w-4" />
              {{
                uploading
                  ? '上传中...'
                  : (uploadMode === 'series' && selectedSeriesPreview?.episodeCount
                    ? `导入并识别 ${selectedSeriesPreview?.episodeCount || 0} 集`
                    : (uploadMode === 'series' ? '开始转换剧集' : '开始转换'))
              }}
            </Button>
          </CardContent>
        </Card>

        <Card v-if="!sidebarCollapsed" class="min-h-0 flex-1 overflow-hidden">
          <CardHeader class="pb-3">
            <div class="flex items-center justify-between gap-2">
              <CardTitle class="flex items-center gap-2 text-base">
                <FileVideo class="h-4 w-4" />
                转换历史
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                @click="showBatchActions = !showBatchActions"
              >
                {{ showBatchActions ? '取消' : '管理' }}
              </Button>
            </div>
            <div v-if="showBatchActions" class="mt-3 space-y-2">
              <div class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  class="flex-1"
                  @click="toggleAllTasks"
                >
                  {{ allTasksSelected ? '取消全选' : '全选' }}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  class="flex-1"
                  :disabled="!hasSelection"
                  @click="handleDeleteSelected"
                >
                  <Trash2 class="mr-1 h-3 w-3" />
                  删除 ({{ selectedTaskIds.size }})
                </Button>
              </div>
              <div class="flex gap-2 text-xs">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 flex-1 text-xs"
                  :disabled="failedTasks.length === 0"
                  @click="handleDeleteFailed"
                >
                  清空失败 ({{ failedTasks.length }})
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 flex-1 text-xs"
                  :disabled="completedTasks.length === 0"
                  @click="handleDeleteCompleted"
                >
                  清空完成 ({{ completedTasks.length }})
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent class="min-h-0 overflow-y-auto p-0">
            <button
              v-for="task in tasks"
              :key="task.id"
              type="button"
              class="w-full border-t px-4 py-3 text-left transition-colors hover:bg-muted/50"
              :class="activeTask?.task.id === task.id ? 'bg-muted' : ''"
              @click="showBatchActions ? toggleTaskSelection(task.id) : handleTaskSelect(task.id)"
            >
              <div class="mb-2 flex items-start justify-between gap-2">
                <div class="flex min-w-0 flex-1 items-start gap-2">
                  <input
                    v-if="showBatchActions"
                    type="checkbox"
                    :checked="selectedTaskIds.has(task.id)"
                    class="mt-1 h-4 w-4 shrink-0 rounded border-gray-300"
                    @click.stop="toggleTaskSelection(task.id)"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="mb-1 font-medium" :title="task.originalFilename">
                      {{ task.originalFilename }}
                    </div>
                    <div class="text-xs text-muted-foreground">
                      <template v-if="task.isSeriesGroup">
                        整部剧
                        <template v-if="task.config?.episodeCount">
                          · {{ task.config.episodeCount }} 集
                        </template>
                        ·
                      </template>
                      {{ formatDateRelative(task.updatedAt) }}
                    </div>
                  </div>
                </div>
                <Badge :variant="statusVariant(task.status)" class="shrink-0">
                  {{ statusLabel(task.status) }}
                </Badge>
              </div>
              <Progress :model-value="task.progress" class="h-1.5" />
              <div
                v-if="task.errorMessage"
                class="mt-2 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                :title="task.errorMessage"
              >
                {{ friendlyErrorMessage(task.errorMessage) }}
              </div>
            </button>
            <div
              v-if="tasks.length === 0"
              class="px-4 py-10 text-center text-sm text-muted-foreground"
            >
              暂无转换记录
            </div>
          </CardContent>
        </Card>

        <div v-if="sidebarCollapsed" class="flex min-h-0 flex-col gap-2 overflow-y-auto pt-2">
          <button
            v-for="task in tasks"
            :key="task.id"
            type="button"
            class="flex flex-col items-center gap-2 rounded-md border p-2 transition-colors hover:bg-muted"
            :class="activeTask?.task.id === task.id ? 'border-primary bg-muted' : ''"
            :title="task.originalFilename"
            @click="handleTaskSelect(task.id)"
          >
            <FileVideo class="h-5 w-5 shrink-0" :class="runningStatuses.has(task.status) ? 'animate-pulse text-primary' : ''" />
            <div class="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div class="h-full bg-primary transition-all" :style="{ width: task.progress + '%' }" />
            </div>
            <Badge :variant="statusVariant(task.status)" class="text-xs px-1 py-0">
              {{ task.status === 'failed' ? '!' : task.status === 'imported' ? '✓' : task.progress + '%' }}
            </Badge>
          </button>
        </div>
      </div>

      <Card class="flex min-h-0 flex-col overflow-hidden">
        <CardHeader class="border-b pb-4">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <CardTitle class="truncate text-lg">
                {{ selectedTask?.originalFilename || '选择任务查看详情' }}
              </CardTitle>
              <CardDescription v-if="selectedTask">
                {{ statusLabel(selectedTask.status) }}
                <template v-if="selectedTask.status !== 'imported' && selectedTask.status !== 'failed' && selectedTask.status !== 'cancelled'">
                  · {{ selectedTask.progress }}%
                </template>
              </CardDescription>
            </div>
            <div
              v-if="selectedTask"
              class="flex flex-wrap gap-2"
            >
              <Button
                v-if="primaryAction"
                size="sm"
                class="gap-2"
                :disabled="primaryAction.disabled"
                @click="primaryAction.action"
              >
                <Wand2 v-if="primaryAction.icon === 'script'" class="h-4 w-4" />
                <FolderInput v-else class="h-4 w-4" />
                {{ primaryAction.label }}
              </Button>
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

          <div v-if="selectedTask && selectedTask.status !== 'cancelled'" class="mt-4 flex items-center gap-2">
            <div class="flex flex-1 items-center gap-2">
              <template
                v-for="(step, index) in workflowSteps"
                :key="step.label"
              >
              <div class="flex items-center gap-2">
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors"
                  :class="step.done ? 'bg-primary text-primary-foreground' : (step.active ? 'bg-primary text-primary-foreground animate-pulse' : 'bg-muted text-muted-foreground')"
                >
                  <span v-if="step.done">✓</span>
                  <span v-else>{{ index + 1 }}</span>
                </div>
                <span class="text-xs font-medium" :class="step.done || step.active ? '' : 'text-muted-foreground'">{{ step.label }}</span>
              </div>
              <div
                v-if="index < workflowSteps.length - 1"
                class="h-px flex-1 bg-border transition-colors"
                :class="workflowSteps[index + 1]?.done || workflowSteps[index + 1]?.active ? 'bg-primary' : ''"
              />
              </template>
            </div>
          </div>
        </CardHeader>

        <CardContent
          v-if="selectedTask"
          class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4"
        >
          <div class="flex gap-2 border-b pb-3">
            <Button
              variant="ghost"
              size="sm"
              :class="contentView === 'subtitle' ? 'bg-muted' : ''"
              @click="contentView = 'subtitle'"
            >
              字幕内容
              <Badge
                v-if="selectedTask.status === 'subtitle_ready'"
                variant="secondary"
                class="ml-2 text-xs"
              >
                待确认
              </Badge>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :class="contentView === 'script' ? 'bg-muted' : ''"
              @click="contentView = 'script'"
            >
              剧本内容
              <Badge
                v-if="selectedTask.status === 'script_ready'"
                variant="secondary"
                class="ml-2 text-xs"
              >
                待确认
              </Badge>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :class="contentView === 'logs' ? 'bg-muted' : ''"
              @click="contentView = 'logs'"
            >
              执行记录
              <Badge
                v-if="activeTask?.stepRuns?.length"
                variant="secondary"
                class="ml-2 text-xs"
              >
                {{ activeTask.stepRuns.length }}
              </Badge>
            </Button>
          </div>

          <section v-show="contentView === 'subtitle'" class="flex min-h-0 flex-1 flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-sm font-medium text-muted-foreground">
                字幕内容
                <span v-if="!canEditSubtitle" class="ml-2 text-xs">(只读)</span>
              </h2>
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
              </div>
            </div>
            <div class="relative min-h-0 flex-1">
              <Textarea
                v-model="subtitleDraft"
                class="h-full resize-none rounded-md border font-mono text-sm leading-6"
                :class="canEditSubtitle ? 'border-primary/50 ring-1 ring-primary/20' : 'bg-muted/30'"
                :disabled="!canEditSubtitle"
                placeholder="识别完成后将显示字幕内容，你可以在此编辑修正"
              />
            </div>
          </section>

          <section v-show="contentView === 'script'" class="flex min-h-0 flex-1 flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-sm font-medium text-muted-foreground">
                剧本内容
                <span v-if="!canEditScript" class="ml-2 text-xs">(只读)</span>
              </h2>
              <div class="flex gap-2">
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
              </div>
            </div>
            <div class="relative min-h-0 flex-1">
              <Textarea
                v-model="scriptDraft"
                class="h-full resize-none rounded-md border font-mono text-sm leading-6"
                :class="canEditScript ? 'border-primary/50 ring-1 ring-primary/20' : 'bg-muted/30'"
                :disabled="!canEditScript"
                placeholder="从字幕生成的剧本将显示在这里，确认无误后即可创建项目"
              />
            </div>
          </section>

          <section v-show="contentView === 'logs'" class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.6fr)]">
              <div class="rounded-md border">
                <div class="border-b px-3 py-2">
                  <h2 class="text-sm font-medium">步骤记录</h2>
                </div>
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
                        <div class="mt-1 truncate text-xs text-muted-foreground" :title="artifact.path">
                          {{ artifact.path }}
                        </div>
                      </div>
                      <span class="shrink-0 text-xs text-muted-foreground">
                        {{ formatBytes(artifact.sizeBytes) }}
                      </span>
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
            </div>
          </section>

          <div class="xl:col-span-2">
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
              {{ tasks.length > 0 ? '从左侧选择一个任务查看详情和进行编辑' : '返回任务列表开始第一个转换任务' }}
            </div>
          </div>
          <Button
            v-if="tasks.length === 0"
            variant="outline"
            class="gap-2 mt-2"
            @click="router.push('/import/video')"
          >
            <ArrowLeft class="h-4 w-4" />
            返回任务列表
          </Button>
        </CardContent>
      </Card>
    </div>
  </div>
  </div>
</template>
