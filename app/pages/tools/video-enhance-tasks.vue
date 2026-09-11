<script setup lang="ts">
import { CheckCircle2, Copy, Download, ExternalLink, FileVideo, FolderOpen, Loader2, MoreHorizontal, RefreshCw, Save, SaveAll, Trash2 } from 'lucide-vue-next'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

definePageMeta({
  layout: 'default'
})

type EnhanceKind = 'standard' | 'professional' | 'fast' | 'generative'
type TaskStatus = 'idle' | 'processing' | 'completed' | 'failed'
type DownloadStatus = 'downloading' | 'completed' | 'failed'

interface TaskDownloadState {
  status: DownloadStatus
  progress: number
  loadedBytes: number
  totalBytes: number
  errorMessage: string
}

interface EnhanceStatusResponse {
  success: boolean
  taskId: string
  status: 'processing' | 'completed' | 'failed'
  rawStatus?: string
  videoUrl?: string | null
  errorMessage?: string | null
}

interface EnhanceSaveResponse {
  success: boolean
  videoUrl: string
}

interface VideoEnhanceTaskRecord {
  id: string
  taskId: string
  batchId?: string | null
  kind: EnhanceKind
  kindLabel: string
  fileName: string
  sourceVideoUrl: string
  sourceObjectKey?: string | null
  sourceDeleted: boolean
  resultVideoUrl?: string | null
  savedVideoUrl?: string | null
  resultObjectKey?: string | null
  resultDeleted: boolean
  status: TaskStatus
  rawStatus?: string | null
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
  completedAt?: string | null
}

interface VideoEnhanceTasksResponse {
  success: boolean
  data: {
    tasks: VideoEnhanceTaskRecord[]
  }
}

const route = useRoute()
const { toast } = useToast()
const { confirm } = useConfirm()

const taskId = ref('')
const status = ref<TaskStatus>('idle')
const rawStatus = ref('')
const sourceVideoUrl = ref('')
const sourceDeleted = ref(false)
const resultVideoUrl = ref('')
const localVideoUrl = ref('')
const resultDeleted = ref(false)
const errorMessage = ref('')
const querying = ref(false)
const saving = ref(false)
const batchSaving = ref(false)
const batchSaveCompleted = ref(0)
const batchSaveTotal = ref(0)
const savingTaskIds = ref<Set<string>>(new Set())
const batchDownloading = ref(false)
const batchDownloadCompleted = ref(0)
const batchDownloadTotal = ref(0)
const batchDownloadFailed = ref(0)
const taskDownloadStates = ref<Record<string, TaskDownloadState>>({})
const downloadDirectory = ref('')
const loadingTasks = ref(false)
const deletingAsset = ref('')
const recentTasks = ref<VideoEnhanceTaskRecord[]>([])
const batchFilter = ref('all')
let pollingTimer: number | null = null

const embeddedInUnifiedTasks = computed(() => ['/tools/enhance', '/tools/enhance-tasks'].includes(route.path))
const canSave = computed(() => (
  resultVideoUrl.value
  && !localVideoUrl.value
  && !saving.value
  && !batchSaving.value
  && !savingTaskIds.value.has(taskId.value)
))
const pollingActive = computed(() => status.value === 'processing' && pollingTimer !== null)
const displayResultVideoUrl = computed(() => localVideoUrl.value || resultVideoUrl.value)
const compareSourceVideoUrl = computed(() => sourceDeleted.value ? '' : sourceVideoUrl.value)
const compareResultVideoUrl = computed(() => resultDeleted.value ? '' : displayResultVideoUrl.value)
const batchOptions = computed(() => {
  const batches = new Map<string, { createdAt: string, count: number }>()
  for (const task of recentTasks.value) {
    if (!task.batchId) continue
    const current = batches.get(task.batchId)
    if (current) {
      current.count += 1
    } else {
      batches.set(task.batchId, { createdAt: task.createdAt, count: 1 })
    }
  }
  return Array.from(batches, ([value, details]) => ({
    value,
    label: `${formatDate(details.createdAt)} · ${details.count} 集`
  }))
})
const filteredTasks = computed(() => batchFilter.value === 'all'
  ? recentTasks.value
  : recentTasks.value.filter(task => task.batchId === batchFilter.value))
const savableFilteredTasks = computed(() => filteredTasks.value.filter(record => (
  record.status === 'completed'
  && Boolean(record.resultVideoUrl)
  && !record.savedVideoUrl
  && !record.resultDeleted
)))
const downloadableFilteredTasks = computed(() => filteredTasks.value.filter(record => (
  record.status === 'completed'
  && Boolean(record.resultVideoUrl || record.savedVideoUrl)
  && !record.resultDeleted
)))
const batchSaveLabel = computed(() => batchFilter.value === 'all' ? '保存全部结果' : '保存当前批次')
const batchDownloadLabel = computed(() => batchFilter.value === 'all' ? '下载全部结果' : '下载当前批次')
const batchSaveProgress = computed(() => {
  if (batchSaveTotal.value === 0) return 0
  return Math.round((batchSaveCompleted.value / batchSaveTotal.value) * 100)
})
const batchDownloadProgress = computed(() => {
  if (batchDownloadTotal.value === 0) return 0
  const activeTaskProgress = Object.values(taskDownloadStates.value)
    .find(item => item.status === 'downloading')?.progress || 0
  return Math.round(((batchDownloadCompleted.value + activeTaskProgress / 100) / batchDownloadTotal.value) * 100)
})
const isDesktopRuntime = computed(() => {
  if (typeof window === 'undefined') return false
  const runtime = window as Window & { __TAURI__?: unknown, __TAURI_INTERNALS__?: unknown }
  return Boolean(runtime.__TAURI__ || runtime.__TAURI_INTERNALS__)
})

onMounted(() => {
  void loadRecentTasks()
  const queryType = getSingleQueryValue(route.query.type as string | string[] | undefined)
  if (embeddedInUnifiedTasks.value && queryType === 'image') return
  const queryTaskId = getSingleQueryValue(route.query.taskId as string | string[] | undefined)
  if (queryTaskId) {
    taskId.value = queryTaskId
    void queryStatus(true)
  }
})

onUnmounted(() => {
  stopPolling()
})

function getSingleQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

async function loadRecentTasks() {
  errorMessage.value = ''
  loadingTasks.value = true
  try {
    const response = await $fetch<VideoEnhanceTasksResponse>('/api/tools/video-enhance/tasks', {
      query: { limit: 200 }
    })
    recentTasks.value = response.data.tasks
    if (batchFilter.value !== 'all' && !recentTasks.value.some(task => task.batchId === batchFilter.value)) {
      batchFilter.value = 'all'
    }
    syncSelectedTaskFromRecords()
  } catch (error) {
    recentTasks.value = []
    errorMessage.value = error instanceof Error ? error.message : '读取画质增强任务失败'
  } finally {
    loadingTasks.value = false
  }
}

function syncSelectedTaskFromRecords() {
  const selectedTaskId = taskId.value.trim()
  if (!selectedTaskId) return
  const selectedRecord = recentTasks.value.find(record => record.taskId === selectedTaskId)
  if (!selectedRecord) return
  sourceVideoUrl.value = selectedRecord.sourceVideoUrl || sourceVideoUrl.value
  sourceDeleted.value = selectedRecord.sourceDeleted
  resultDeleted.value = selectedRecord.resultDeleted
  if (!resultVideoUrl.value) {
    resultVideoUrl.value = selectedRecord.resultVideoUrl || ''
  }
  if (!localVideoUrl.value) {
    localVideoUrl.value = selectedRecord.savedVideoUrl || ''
  }
}

function stopPolling() {
  if (pollingTimer) {
    window.clearTimeout(pollingTimer)
    pollingTimer = null
  }
}

function selectTask(record: VideoEnhanceTaskRecord) {
  taskId.value = record.taskId
  status.value = record.status
  rawStatus.value = record.rawStatus || record.status
  sourceVideoUrl.value = record.sourceVideoUrl || ''
  sourceDeleted.value = record.sourceDeleted
  resultVideoUrl.value = record.resultVideoUrl || ''
  localVideoUrl.value = record.savedVideoUrl || ''
  resultDeleted.value = record.resultDeleted
  errorMessage.value = record.errorMessage || ''
  void queryStatus(true)
}

async function queryStatus(autoPoll = false) {
  const id = taskId.value.trim()
  if (!id || querying.value) return

  stopPolling()
  querying.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<EnhanceStatusResponse>(`/api/tools/video-enhance/status/${encodeURIComponent(id)}`)
    rawStatus.value = response.rawStatus || response.status
    localVideoUrl.value = ''
    resultDeleted.value = false
    if (response.status === 'completed') {
      status.value = 'completed'
      resultVideoUrl.value = response.videoUrl || ''
      void loadRecentTasks()
      return
    }
    if (response.status === 'failed') {
      status.value = 'failed'
      resultVideoUrl.value = ''
      errorMessage.value = response.errorMessage || '火山引擎任务处理失败，请检查任务 ID 或模型日志。'
      void loadRecentTasks()
      return
    }
    status.value = 'processing'
    resultVideoUrl.value = ''
    if (autoPoll) {
      pollingTimer = window.setTimeout(() => {
        void queryStatus(true)
      }, 10000)
    }
    void loadRecentTasks()
  } catch (error) {
    status.value = 'failed'
    resultVideoUrl.value = ''
    errorMessage.value = error instanceof Error ? error.message : '查询画质增强任务失败'
  } finally {
    querying.value = false
  }
}

function setTaskSaving(id: string, value: boolean) {
  const next = new Set(savingTaskIds.value)
  if (value) next.add(id)
  else next.delete(id)
  savingTaskIds.value = next
}

async function persistTaskResult(task: Pick<VideoEnhanceTaskRecord, 'taskId' | 'resultVideoUrl'>) {
  if (!task.resultVideoUrl) throw new Error('该任务暂无可保存的结果视频')
  setTaskSaving(task.taskId, true)
  try {
    const response = await $fetch<EnhanceSaveResponse>('/api/tools/video-enhance/save', {
      method: 'POST',
      body: { taskId: task.taskId, videoUrl: task.resultVideoUrl }
    })
    const record = recentTasks.value.find(item => item.taskId === task.taskId)
    if (record) {
      record.savedVideoUrl = response.videoUrl
      record.resultDeleted = false
    }
    if (taskId.value === task.taskId) {
      localVideoUrl.value = response.videoUrl
      resultDeleted.value = false
    }
    return response
  } finally {
    setTaskSaving(task.taskId, false)
  }
}

async function saveResult() {
  if (!resultVideoUrl.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    await persistTaskResult({ taskId: taskId.value, resultVideoUrl: resultVideoUrl.value })
    toast.success('结果视频已保存')
    await loadRecentTasks()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存增强后视频失败'
  } finally {
    saving.value = false
  }
}

async function saveTaskResult(record: VideoEnhanceTaskRecord) {
  errorMessage.value = ''
  try {
    await persistTaskResult(record)
    toast.success(`「${record.fileName}」已保存`)
    await loadRecentTasks()
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存增强后视频失败'
    record.errorMessage = message
    errorMessage.value = `「${record.fileName}」保存失败：${message}`
  }
}

async function saveFilteredResults() {
  const tasks = [...savableFilteredTasks.value]
  if (tasks.length === 0 || batchSaving.value) return
  const scopeLabel = batchFilter.value === 'all' ? '当前列表' : '当前批次'
  const confirmed = await confirm({
    title: `保存${scopeLabel}的 ${tasks.length} 个结果视频？`,
    description: '将依次保存所有已完成且尚未保存的视频；处理中、失败和已保存的任务会自动跳过。',
    confirmText: '开始保存',
    cancelText: '取消'
  })
  if (!confirmed) return

  batchSaving.value = true
  batchSaveCompleted.value = 0
  batchSaveTotal.value = tasks.length
  errorMessage.value = ''
  let successCount = 0
  let failedCount = 0
  const failedTaskErrors = new Map<string, string>()
  try {
    for (const task of tasks) {
      try {
        await persistTaskResult(task)
        successCount += 1
      } catch (error) {
        failedTaskErrors.set(task.taskId, error instanceof Error ? error.message : '保存增强后视频失败')
        failedCount += 1
      } finally {
        batchSaveCompleted.value += 1
      }
    }
    await loadRecentTasks()
    for (const record of recentTasks.value) {
      if (failedTaskErrors.has(record.taskId)) record.errorMessage = failedTaskErrors.get(record.taskId)
    }
    if (successCount > 0) toast.success(`已保存 ${successCount} 个结果视频`)
    if (failedCount > 0) {
      errorMessage.value = `${failedCount} 个结果保存失败，可在任务列表中单独重试。`
    }
  } finally {
    batchSaving.value = false
  }
}

function taskDownloadState(id: string) {
  return taskDownloadStates.value[id]
}

function setTaskDownloadState(id: string, state: TaskDownloadState) {
  taskDownloadStates.value = { ...taskDownloadStates.value, [id]: state }
}

function resultDownloadFileName(fileName: string) {
  const name = fileName.split(/[\\/]/).pop()?.trim() || 'video.mp4'
  const stem = name.replace(/\.[^.]+$/, '') || 'video'
  return `${stem}-enhanced.mp4`
}

function formatDownloadBytes(value: number) {
  if (!value) return '准备中'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

function contentDispositionFileName(value: string | null) {
  if (!value) return ''
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return ''
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1]?.trim() || ''
}

function saveDownloadedBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function resolveDownloadDirectory() {
  if (!isDesktopRuntime.value || downloadDirectory.value) return downloadDirectory.value
  try {
    const { downloadDir } = await import('@tauri-apps/api/path')
    downloadDirectory.value = await downloadDir()
  } catch {
    downloadDirectory.value = ''
  }
  return downloadDirectory.value
}

async function openDownloadDirectory() {
  const directory = downloadDirectory.value || await resolveDownloadDirectory()
  if (!directory) {
    toast.warning('无法定位下载目录', { description: '请在系统文件管理器中打开浏览器默认下载目录。' })
    return
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_local_directory', { path: directory })
  } catch (error) {
    toast.error('无法打开下载目录', {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

async function downloadTaskResult(record: VideoEnhanceTaskRecord, showToast = true) {
  if (record.status !== 'completed' || record.resultDeleted) return false
  if (taskDownloadState(record.taskId)?.status === 'downloading') return false

  setTaskDownloadState(record.taskId, {
    status: 'downloading',
    progress: 0,
    loadedBytes: 0,
    totalBytes: 0,
    errorMessage: ''
  })
  try {
    const response = await fetch(`/api/tools/video-enhance/download/${encodeURIComponent(record.taskId)}`)
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null
      throw new Error(payload?.message || `下载失败 (${response.status})`)
    }
    if (!response.body) throw new Error('浏览器未返回下载内容')

    const totalBytes = Number(response.headers.get('content-length')) || 0
    if (totalBytes > 2 * 1024 * 1024 * 1024) {
      throw new Error('视频超过 2GB，暂不支持在页面内下载')
    }
    const reader = response.body.getReader()
    const chunks: ArrayBuffer[] = []
    let loadedBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value.slice().buffer as ArrayBuffer)
      loadedBytes += value.byteLength
      setTaskDownloadState(record.taskId, {
        status: 'downloading',
        progress: totalBytes > 0 ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100)) : 0,
        loadedBytes,
        totalBytes,
        errorMessage: ''
      })
    }
    if (loadedBytes === 0) throw new Error('下载内容为空')

    const contentType = response.headers.get('content-type') || 'video/mp4'
    const fileName = contentDispositionFileName(response.headers.get('content-disposition'))
      || resultDownloadFileName(record.fileName)
    saveDownloadedBlob(new Blob(chunks, { type: contentType }), fileName)
    const directory = await resolveDownloadDirectory()
    setTaskDownloadState(record.taskId, {
      status: 'completed',
      progress: 100,
      loadedBytes,
      totalBytes: totalBytes || loadedBytes,
      errorMessage: ''
    })
    if (showToast) {
      toast.success(`「${fileName}」下载完成`, {
        description: directory ? `已保存到系统下载目录：${directory}` : '已保存到浏览器默认下载目录'
      })
    }
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : '下载结果视频失败'
    const current = taskDownloadState(record.taskId)
    setTaskDownloadState(record.taskId, {
      status: 'failed',
      progress: current?.progress || 0,
      loadedBytes: current?.loadedBytes || 0,
      totalBytes: current?.totalBytes || 0,
      errorMessage: message
    })
    if (showToast) toast.error(`「${record.fileName}」下载失败`, { description: message })
    return false
  }
}

async function downloadSelectedResult() {
  const record = recentTasks.value.find(item => item.taskId === taskId.value)
  if (record) await downloadTaskResult(record)
}

async function downloadFilteredResults() {
  const tasks = [...downloadableFilteredTasks.value]
  if (tasks.length === 0 || batchDownloading.value) return
  if (tasks.length > 1) {
    const scopeLabel = batchFilter.value === 'all' ? '当前列表' : '当前批次'
    const confirmed = await confirm({
      title: `下载${scopeLabel}的 ${tasks.length} 个结果视频？`,
      description: '将逐个下载已完成的视频，并以原文件名加 enhanced 后缀保存。单个文件失败不会中断后续下载。',
      confirmText: '开始下载',
      cancelText: '取消'
    })
    if (!confirmed) return
  }

  batchDownloading.value = true
  batchDownloadCompleted.value = 0
  batchDownloadTotal.value = tasks.length
  batchDownloadFailed.value = 0
  errorMessage.value = ''
  try {
    for (const task of tasks) {
      const succeeded = await downloadTaskResult(task, false)
      if (!succeeded) batchDownloadFailed.value += 1
      batchDownloadCompleted.value += 1
    }
    const successCount = tasks.length - batchDownloadFailed.value
    if (successCount > 0) toast.success(`已下载 ${successCount} 个结果视频`)
    if (batchDownloadFailed.value > 0) {
      errorMessage.value = `${batchDownloadFailed.value} 个视频下载失败，可在任务行中重试。`
    }
  } finally {
    batchDownloading.value = false
  }
}

async function deleteTaskAsset(record: VideoEnhanceTaskRecord, asset: 'source' | 'result') {
  const confirmed = await confirm({
    title: asset === 'source' ? '删除源视频？' : '删除结果视频？',
    description: asset === 'source'
      ? `将从存储中删除「${record.fileName}」的源视频文件，任务记录会保留。`
      : `将从存储中删除「${record.fileName}」的增强结果文件，任务记录会保留。`,
    confirmText: '删除',
    cancelText: '取消',
    variant: 'destructive'
  })
  if (!confirmed) return

  const key = `${record.taskId}:${asset}`
  deletingAsset.value = key
  errorMessage.value = ''
  try {
    await $fetch(`/api/tools/video-enhance/tasks/${encodeURIComponent(record.taskId)}/${asset}`, {
      method: 'DELETE'
    })
    toast.success(asset === 'source' ? '源视频已删除' : '结果视频已删除')
    if (taskId.value === record.taskId) {
      if (asset === 'source') {
        sourceDeleted.value = true
      } else {
        resultDeleted.value = true
        resultVideoUrl.value = ''
        localVideoUrl.value = ''
      }
    }
    await loadRecentTasks()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除任务文件失败'
  } finally {
    deletingAsset.value = ''
  }
}

async function copyText(value: string) {
  if (!value || typeof navigator === 'undefined') return
  await navigator.clipboard?.writeText(value)
  toast.success('已复制任务 ID')
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function taskStatusLabel(value: TaskStatus | string) {
  switch (value) {
    case 'idle':
      return '等待查询'
    case 'processing':
      return '处理中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    default:
      return value
  }
}

function taskStatusVariant(value: TaskStatus | string) {
  switch (value) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'destructive'
    case 'processing':
      return 'default'
    default:
      return 'secondary'
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col bg-background">
    <AppPageHeader
      v-if="!embeddedInUnifiedTasks"
      title="画质增强任务"
      description="查询火山引擎 AI MediaKit 画质增强任务状态，完成后保存结果视频。"
    >
      <template #actions>
        <Button
          variant="outline"
          size="sm"
          as-child
        >
          <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'video', view: 'create' } }">
            提交增强
          </NuxtLink>
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent
      scroll
      inner-class="w-full max-w-6xl space-y-5"
    >
      <section class="p-1">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <form
            class="flex w-full min-w-0 gap-2 sm:max-w-xl"
            @submit.prevent="queryStatus(true)"
          >
            <Input
              v-model="taskId"
              placeholder="输入 task_id，回车查询"
              class="min-w-0 flex-1 bg-background font-mono"
            />
            <Button
              v-if="taskId"
              variant="outline"
              size="icon"
              class="shrink-0 bg-background"
              title="复制任务 ID"
              @click="copyText(taskId)"
            >
              <Copy class="h-4 w-4" />
            </Button>
          </form>
        </div>

        <div
          v-if="pollingActive"
          class="mt-4 flex items-center justify-between rounded-xl border-0 bg-primary/8 px-3 py-2 text-sm"
        >
          <div class="flex items-center gap-2 text-primary">
            <Loader2 class="h-4 w-4 animate-spin" />
            正在自动轮询，每 10 秒刷新一次。
          </div>
          <Button
            variant="ghost"
            size="sm"
            @click="stopPolling"
          >
            停止轮询
          </Button>
        </div>

        <div
          v-if="errorMessage"
          class="mt-4 rounded-xl bg-destructive/10 p-3 text-sm leading-6 text-destructive"
        >
          {{ errorMessage }}
        </div>
      </section>

      <section
        v-if="resultVideoUrl"
        class="space-y-3"
      >
        <ToolsVideoCompareViewer
          :before-url="compareSourceVideoUrl"
          :after-url="compareResultVideoUrl"
          before-label="源视频"
          :after-label="localVideoUrl ? '已保存结果' : '云端结果'"
          empty-label="暂无结果"
        />
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            as-child
          >
            <a
              :href="localVideoUrl || resultVideoUrl"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink class="mr-2 h-4 w-4" />
              打开视频
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="!canSave"
            @click="saveResult"
          >
            <Loader2
              v-if="saving"
              class="mr-2 h-4 w-4 animate-spin"
            />
            <Save
              v-else
              class="mr-2 h-4 w-4"
            />
            {{ localVideoUrl ? '已保存' : '保存结果' }}
          </Button>
          <Button
            size="sm"
            @click="downloadSelectedResult"
          >
            <Download class="mr-2 h-4 w-4" />
            下载视频
          </Button>
        </div>
        <div
          v-if="localVideoUrl"
          class="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-200"
        >
          已保存：{{ localVideoUrl }}
        </div>
      </section>

      <section class="space-y-3">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-foreground">
              任务列表
            </h2>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <Select
              v-if="batchOptions.length"
              v-model="batchFilter"
              :disabled="batchSaving"
            >
              <SelectTrigger class="w-64 bg-background">
                <SelectValue placeholder="筛选提交批次" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  全部批次
                </SelectItem>
                <SelectItem
                  v-for="option in batchOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="default"
              size="sm"
              class="shrink-0"
              :disabled="batchSaving || batchDownloading || downloadableFilteredTasks.length === 0"
              @click="downloadFilteredResults"
            >
              <Loader2
                v-if="batchDownloading"
                class="mr-2 h-4 w-4 animate-spin"
              />
              <Download
                v-else
                class="mr-2 h-4 w-4"
              />
              {{ batchDownloading ? `下载中 ${batchDownloadCompleted}/${batchDownloadTotal}` : `${batchDownloadLabel} (${downloadableFilteredTasks.length})` }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="shrink-0"
              :disabled="loadingTasks || batchSaving"
              @click="loadRecentTasks"
            >
              <Loader2
                v-if="loadingTasks"
                class="mr-2 h-4 w-4 animate-spin"
              />
              <RefreshCw
                v-else
                class="mr-2 h-4 w-4"
              />
              {{ loadingTasks ? '正在刷新' : '刷新列表' }}
            </Button>
            <Button
              v-if="downloadDirectory"
              type="button"
              variant="outline"
              size="icon"
              class="shrink-0"
              title="打开下载目录"
              aria-label="打开下载目录"
              @click="openDownloadDirectory"
            >
              <FolderOpen class="h-4 w-4" />
            </Button>
            <DropdownMenu v-if="savableFilteredTasks.length > 0">
              <DropdownMenuTrigger as-child>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  class="shrink-0"
                  title="更多批量操作"
                  aria-label="更多批量操作"
                  :disabled="batchSaving || batchDownloading"
                >
                  <MoreHorizontal class="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem @select="saveFilteredResults">
                  <SaveAll class="h-4 w-4 text-muted-foreground" />
                  {{ `${batchSaveLabel} (${savableFilteredTasks.length})` }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div
          v-if="batchSaving"
          class="space-y-1.5 rounded-md bg-primary/5 px-3 py-2"
          aria-live="polite"
        >
          <div class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>正在依次保存结果视频</span>
            <span class="tabular-nums">{{ batchSaveCompleted }}/{{ batchSaveTotal }}</span>
          </div>
          <Progress :model-value="batchSaveProgress" />
        </div>
        <div
          v-if="batchDownloading"
          class="space-y-1.5 rounded-md bg-primary/5 px-3 py-2"
          aria-live="polite"
        >
          <div class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>正在下载第 {{ Math.min(batchDownloadCompleted + 1, batchDownloadTotal) }} 个视频</span>
            <span class="tabular-nums">{{ batchDownloadProgress }}%</span>
          </div>
          <Progress :model-value="batchDownloadProgress" />
        </div>

        <div
          v-if="recentTasks.length === 0"
          class="flex min-h-56 flex-col items-center justify-center rounded-xl bg-muted/15 bg-muted/10 p-8 text-center"
        >
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FileVideo class="h-6 w-6" />
          </div>
          <div class="mt-4 text-base font-semibold text-foreground">
            暂无增强任务
          </div>
          <div class="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
            提交视频增强后，任务会出现在这里。
          </div>
          <Button
            size="sm"
            class="mt-4"
            as-child
          >
            <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'video', view: 'create' } }">
              提交增强
            </NuxtLink>
          </Button>
        </div>
        <div
          v-else
          class="overflow-hidden rounded-xl bg-muted/25"
        >
          <div class="hidden grid-cols-[minmax(0,1fr)_120px_120px_132px] gap-4 border-b bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
            <div>文件</div>
            <div>类型</div>
            <div>状态</div>
            <div class="text-right">操作</div>
          </div>
          <div
            v-for="record in filteredTasks"
            :key="record.taskId"
            class="grid min-h-14 gap-3 border-b px-4 py-2.5 transition-colors last:border-b-0 lg:grid-cols-[minmax(0,1fr)_120px_120px_132px] lg:items-center"
            :class="taskId === record.taskId ? 'bg-primary/5' : 'hover:bg-muted/30'"
          >
            <button
              type="button"
              class="min-w-0 text-left"
              @click="selectTask(record)"
            >
              <div class="flex min-w-0 items-baseline gap-3">
                <span class="truncate text-sm font-medium text-foreground">
                  {{ record.fileName }}
                </span>
                <span class="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {{ formatDate(record.createdAt) }}
                </span>
              </div>
              <div
                v-if="taskDownloadState(record.taskId)?.status === 'downloading'"
                class="mt-2 flex items-center gap-2 text-xs text-primary"
              >
                <Progress
                  :model-value="taskDownloadState(record.taskId)?.progress || 0"
                  class="h-1.5 max-w-32"
                />
                <span class="shrink-0 tabular-nums">
                  {{ taskDownloadState(record.taskId)?.totalBytes ? `${taskDownloadState(record.taskId)?.progress}%` : formatDownloadBytes(taskDownloadState(record.taskId)?.loadedBytes || 0) }}
                </span>
              </div>
              <div
                v-else-if="taskDownloadState(record.taskId)?.status === 'failed'"
                class="mt-1 truncate text-xs text-destructive"
                :title="taskDownloadState(record.taskId)?.errorMessage"
              >
                下载失败：{{ taskDownloadState(record.taskId)?.errorMessage }}
              </div>
            </button>
            <div>
              <Badge variant="outline">
                {{ record.kindLabel }}
              </Badge>
            </div>
            <div>
              <Badge :variant="taskStatusVariant(record.status)">
                {{ taskStatusLabel(record.status) }}
              </Badge>
            </div>
            <div class="flex h-8 items-center justify-end gap-1">
              <Button
                v-if="record.status === 'completed' && (record.resultVideoUrl || record.savedVideoUrl) && !record.resultDeleted"
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                :class="taskDownloadState(record.taskId)?.status === 'completed' ? 'text-success hover:text-success' : ''"
                :title="taskDownloadState(record.taskId)?.status === 'failed' ? '重试下载' : taskDownloadState(record.taskId)?.status === 'completed' ? '下载完成，点击重新下载' : '下载结果'"
                :aria-label="taskDownloadState(record.taskId)?.status === 'failed' ? '重试下载' : '下载结果'"
                :disabled="batchDownloading || taskDownloadState(record.taskId)?.status === 'downloading'"
                @click="downloadTaskResult(record)"
              >
                <Loader2
                  v-if="taskDownloadState(record.taskId)?.status === 'downloading'"
                  class="h-4 w-4 animate-spin"
                />
                <RefreshCw
                  v-else-if="taskDownloadState(record.taskId)?.status === 'failed'"
                  class="h-4 w-4"
                />
                <CheckCircle2
                  v-else-if="taskDownloadState(record.taskId)?.status === 'completed'"
                  class="h-4 w-4"
                />
                <Download v-else class="h-4 w-4" />
              </Button>
              <Button
                v-if="taskDownloadState(record.taskId)?.status === 'completed' && downloadDirectory"
                type="button"
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-muted-foreground"
                title="打开下载目录"
                aria-label="打开下载目录"
                @click="openDownloadDirectory"
              >
                <FolderOpen class="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8 text-muted-foreground"
                    title="更多操作"
                    aria-label="更多操作"
                    :disabled="batchSaving || deletingAsset.startsWith(`${record.taskId}:`)"
                  >
                    <Loader2
                      v-if="deletingAsset.startsWith(`${record.taskId}:`)"
                      class="h-4 w-4 animate-spin"
                    />
                    <MoreHorizontal v-else class="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @select="copyText(record.taskId)">
                    <Copy class="h-4 w-4 text-muted-foreground" />
                    复制任务 ID
                  </DropdownMenuItem>
                  <DropdownMenuSeparator
                    v-if="record.status === 'completed' && record.resultVideoUrl && !record.savedVideoUrl && !record.resultDeleted || record.sourceObjectKey && !record.sourceDeleted || record.resultObjectKey && !record.resultDeleted"
                  />
                  <DropdownMenuItem
                    v-if="record.status === 'completed' && record.resultVideoUrl && !record.savedVideoUrl && !record.resultDeleted"
                    :disabled="savingTaskIds.has(record.taskId)"
                    @select="saveTaskResult(record)"
                  >
                    <Loader2
                      v-if="savingTaskIds.has(record.taskId)"
                      class="h-4 w-4 animate-spin"
                    />
                    <Save v-else class="h-4 w-4 text-muted-foreground" />
                    {{ savingTaskIds.has(record.taskId) ? '正在保存' : '保存到项目' }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator
                    v-if="record.status === 'completed' && record.resultVideoUrl && !record.savedVideoUrl && !record.resultDeleted && (record.sourceObjectKey && !record.sourceDeleted || record.resultObjectKey && !record.resultDeleted)"
                  />
                  <DropdownMenuItem
                    v-if="record.sourceObjectKey && !record.sourceDeleted"
                    destructive
                    @select="deleteTaskAsset(record, 'source')"
                  >
                    <Trash2 class="h-4 w-4" />
                    删除源视频
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="record.resultObjectKey && !record.resultDeleted"
                    destructive
                    @select="deleteTaskAsset(record, 'result')"
                  >
                    <Trash2 class="h-4 w-4" />
                    删除结果视频
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </section>
    </AppPageContent>
  </div>
</template>
