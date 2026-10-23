<script setup lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { Check, Copy, Download, Eraser, FileVideo, History, Loader2, Plus, RefreshCw, Save, TriangleAlert } from 'lucide-vue-next'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

definePageMeta({ layout: 'default' })

type TaskStatus = 'processing' | 'completed' | 'failed'
type StatusFilter = 'all' | TaskStatus

interface SubtitleErasureTask {
  id?: string
  taskId: string
  fileName: string
  sourceVideoUrl: string
  status: TaskStatus
  rawStatus?: string
  resultVideoUrl?: string
  savedVideoUrl?: string
  errorMessage?: string
  createdAt?: string
  updatedAt?: string
  completedAt?: string
}

interface TaskListResponse {
  success: boolean
  data: { tasks: SubtitleErasureTask[] }
}

interface TaskStatusResponse {
  success: boolean
  taskId: string
  status: TaskStatus
  rawStatus?: string
  videoUrl?: string
  errorMessage?: string
}

interface SaveResponse {
  success: boolean
  videoUrl: string
}

const POLL_INTERVAL_MS = 10000
const route = useRoute()
const router = useRouter()
const { toast } = useToast()
const tasks = ref<SubtitleErasureTask[]>([])
const selectedTaskId = ref('')
const statusFilter = ref<StatusFilter>('all')
const loading = ref(false)
const refreshing = ref(false)
const saving = ref(false)
const downloading = ref(false)
const copied = ref(false)
const polling = ref(false)
const errorMessage = ref('')
let pollingTimer: number | null = null
let copiedTimer: number | null = null

const embeddedInMediaWorkbench = computed(() => route.path === '/tools/enhance')
const selectedTask = computed(() => tasks.value.find(task => task.taskId === selectedTaskId.value))
const filteredTasks = computed(() => {
  if (statusFilter.value === 'all') return tasks.value
  return tasks.value.filter(task => task.status === statusFilter.value)
})
const statusCounts = computed(() => ({
  all: tasks.value.length,
  processing: tasks.value.filter(task => task.status === 'processing').length,
  completed: tasks.value.filter(task => task.status === 'completed').length,
  failed: tasks.value.filter(task => task.status === 'failed').length
}))

onMounted(async () => {
  await loadTasks()
  const queryTaskId = Array.isArray(route.query.taskId) ? route.query.taskId[0] : route.query.taskId
  if (queryTaskId) {
    selectedTaskId.value = queryTaskId
    if (!selectedTask.value) {
      tasks.value.unshift({
        taskId: queryTaskId,
        fileName: '新提交的视频',
        sourceVideoUrl: '',
        status: 'processing'
      })
    }
    await refreshTask(true)
  } else if (tasks.value[0]) {
    selectTask(tasks.value[0])
  }
})

onUnmounted(() => {
  stopPolling()
  if (copiedTimer) window.clearTimeout(copiedTimer)
})

function statusLabel(status: TaskStatus) {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '处理失败'
  return '处理中'
}

function statusVariant(status: TaskStatus) {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'destructive'
  return 'default'
}

function formatDate(value?: string) {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function stopPolling() {
  polling.value = false
  if (pollingTimer) {
    window.clearTimeout(pollingTimer)
    pollingTimer = null
  }
}

function schedulePolling() {
  stopPolling()
  polling.value = true
  pollingTimer = window.setTimeout(() => {
    void refreshTask(true)
  }, POLL_INTERVAL_MS)
}

async function loadTasks(preserveSelection = true) {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<TaskListResponse>('/api/tools/subtitle-erasure/tasks', {
      query: { limit: 200 }
    })
    const currentId = selectedTaskId.value
    tasks.value = response.data.tasks
    if (preserveSelection && currentId && tasks.value.some(task => task.taskId === currentId)) {
      selectedTaskId.value = currentId
    } else if (!selectedTaskId.value && tasks.value[0]) {
      selectedTaskId.value = tasks.value[0].taskId
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '读取字幕擦除任务失败'
  } finally {
    loading.value = false
  }
}

function selectTask(task: SubtitleErasureTask) {
  stopPolling()
  selectedTaskId.value = task.taskId
  void router.replace({ query: { ...route.query, taskId: task.taskId } })
  if (task.status === 'processing') schedulePolling()
}

async function refreshTask(autoPoll = false) {
  const task = selectedTask.value
  if (!task || refreshing.value) return
  stopPolling()
  refreshing.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<TaskStatusResponse>(
      `/api/tools/subtitle-erasure/status/${encodeURIComponent(task.taskId)}`
    )
    task.status = response.status
    task.rawStatus = response.rawStatus
    task.resultVideoUrl = response.videoUrl || task.resultVideoUrl
    task.errorMessage = response.errorMessage
    if (response.status === 'processing' && autoPoll) schedulePolling()
    if (response.status === 'completed') toast.success('字幕擦除已完成')
    await loadTasks()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '查询字幕擦除任务失败'
    if (autoPoll) schedulePolling()
  } finally {
    refreshing.value = false
  }
}

async function saveResult() {
  const task = selectedTask.value
  if (!task?.resultVideoUrl || saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<SaveResponse>('/api/tools/subtitle-erasure/save', {
      method: 'POST',
      body: { taskId: task.taskId }
    })
    task.savedVideoUrl = response.videoUrl
    toast.success('结果已保存到素材存储')
    await loadTasks()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存字幕擦除结果失败'
  } finally {
    saving.value = false
  }
}

function downloadFileName(fileName: string) {
  const name = fileName.split(/[\\/]/).pop()?.trim() || 'video.mp4'
  const stem = name.replace(/\.[^.]+$/, '') || 'video'
  return `${stem}-subtitle-erased.mp4`
}

async function downloadResult() {
  const task = selectedTask.value
  if (!task || task.status !== 'completed' || downloading.value) return
  downloading.value = true
  errorMessage.value = ''
  try {
    const path = `/api/tools/subtitle-erasure/download/${encodeURIComponent(task.taskId)}`
    if (isTauri()) {
      const savedPath = await invoke<string>('save_project_video', {
        url: `http://127.0.0.1:43127${path}`,
        fileName: downloadFileName(task.fileName),
        projectName: '字幕擦除'
      })
      toast.success('结果视频已保存', { description: savedPath })
      return
    }
    const response = await fetch(path)
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined) as { message?: string } | undefined
      throw new Error(payload?.message || `下载失败（${response.status}）`)
    }
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = downloadFileName(task.fileName)
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    toast.success('结果视频已开始下载')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '下载字幕擦除结果失败'
  } finally {
    downloading.value = false
  }
}

async function copyTaskId() {
  const taskId = selectedTaskId.value
  if (!taskId) return
  try {
    await navigator.clipboard.writeText(taskId)
    copied.value = true
    if (copiedTimer) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => { copied.value = false }, 1500)
  } catch {
    toast.error('复制失败')
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col bg-background">
    <AppPageHeader
      v-if="!embeddedInMediaWorkbench"
      title="字幕擦除任务"
      description="查看处理进度、预览修复效果并下载无字幕视频。"
    >
      <template #actions>
        <Button size="sm" as-child>
          <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'subtitle-erasure', view: 'create' } }">
            <Plus class="mr-2 h-4 w-4" />
            新建任务
          </NuxtLink>
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent scroll inner-class="w-full max-w-7xl space-y-5">
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="filter in ([['all', '全部'], ['processing', '处理中'], ['completed', '已完成'], ['failed', '失败']] as const)"
          :key="filter[0]"
          size="sm"
          :variant="statusFilter === filter[0] ? 'default' : 'outline'"
          class="active:scale-[0.96] transition-transform"
          @click="statusFilter = filter[0]"
        >
          {{ filter[1] }}
          <span class="ml-1.5 font-mono text-[11px] tabular-nums opacity-70">{{ statusCounts[filter[0]] }}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="ml-auto active:scale-[0.96] transition-transform"
          :disabled="loading"
          @click="loadTasks()"
        >
          <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
          <RefreshCw v-else class="mr-2 h-4 w-4" />
          刷新列表
        </Button>
      </div>

      <div
        v-if="errorMessage"
        class="flex items-start gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive"
      >
        <TriangleAlert class="mt-1 h-4 w-4 shrink-0" />
        <span>{{ errorMessage }}</span>
      </div>

      <div class="grid min-h-[520px] gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside class="overflow-hidden rounded-2xl bg-card shadow-[0_1px_2px_oklch(0_0_0/0.05),inset_0_0_0_1px_oklch(0_0_0/0.06)] dark:shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)]">
          <div class="flex items-center gap-2 px-4 py-3 text-sm font-semibold">
            <History class="h-4 w-4 text-muted-foreground" />
            最近任务
          </div>
          <div v-if="loading && !tasks.length" class="flex items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
            <Loader2 class="h-4 w-4 animate-spin" />
            正在读取
          </div>
          <div v-else-if="!filteredTasks.length" class="flex flex-col items-center px-6 py-16 text-center">
            <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <FileVideo class="h-5 w-5 text-muted-foreground" />
            </span>
            <p class="mt-3 text-sm font-medium">暂无匹配任务</p>
            <p class="mt-1 text-xs text-muted-foreground">提交视频后，处理记录会显示在这里。</p>
          </div>
          <div v-else class="max-h-[640px] space-y-1 overflow-y-auto p-2 pt-0">
            <button
              v-for="task in filteredTasks"
              :key="task.taskId"
              type="button"
              class="w-full rounded-xl px-3 py-3 text-left transition-colors duration-150 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.96]"
              :class="selectedTaskId === task.taskId ? 'bg-muted' : ''"
              @click="selectTask(task)"
            >
              <div class="flex items-start gap-3">
                <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background shadow-sm">
                  <Eraser class="h-4 w-4 text-muted-foreground" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{{ task.fileName }}</p>
                  <div class="mt-1.5 flex items-center justify-between gap-2">
                    <span class="text-xs text-muted-foreground">{{ formatDate(task.createdAt) }}</span>
                    <Badge :variant="statusVariant(task.status)" class="shrink-0">{{ statusLabel(task.status) }}</Badge>
                  </div>
                </div>
              </div>
            </button>
          </div>
        </aside>

        <section class="min-w-0 overflow-hidden rounded-2xl bg-card shadow-[0_1px_2px_oklch(0_0_0/0.05),inset_0_0_0_1px_oklch(0_0_0/0.06)] dark:shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)]">
          <div v-if="selectedTask" class="space-y-5 p-5">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <h2 class="truncate text-base font-semibold">{{ selectedTask.fileName }}</h2>
                  <Badge :variant="statusVariant(selectedTask.status)">{{ statusLabel(selectedTask.status) }}</Badge>
                </div>
                <button
                  type="button"
                  class="mt-1.5 flex max-w-full items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
                  title="复制任务 ID"
                  @click="copyTaskId"
                >
                  <span class="truncate">{{ selectedTask.taskId }}</span>
                  <Check v-if="copied" class="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <Copy v-else class="h-3.5 w-3.5 shrink-0" />
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                :disabled="refreshing"
                class="shrink-0 active:scale-[0.96] transition-transform"
                @click="refreshTask(selectedTask.status === 'processing')"
              >
                <Loader2 v-if="refreshing" class="mr-2 h-4 w-4 animate-spin" />
                <RefreshCw v-else class="mr-2 h-4 w-4" />
                查询状态
              </Button>
            </div>

            <div v-if="selectedTask.status === 'processing'" class="rounded-xl bg-primary/8 px-4 py-3">
              <div class="flex items-center gap-3">
                <Loader2 class="h-5 w-5 shrink-0 animate-spin text-primary" />
                <div>
                  <p class="text-sm font-medium text-primary">正在处理视频</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {{ polling ? '页面将每 10 秒自动查询一次，离开页面不会中断云端任务。' : '点击“查询状态”获取最新进度。' }}
                  </p>
                </div>
              </div>
            </div>

            <div v-else-if="selectedTask.status === 'failed'" class="rounded-xl bg-destructive/10 px-4 py-3">
              <div class="flex items-start gap-3">
                <TriangleAlert class="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <p class="text-sm font-medium text-destructive">字幕擦除失败</p>
                  <p class="mt-1 text-xs leading-5 text-muted-foreground">{{ selectedTask.errorMessage || '服务未返回具体错误，请稍后重试或查看模型日志。' }}</p>
                </div>
              </div>
            </div>

            <template v-else-if="selectedTask.status === 'completed' && selectedTask.resultVideoUrl">
              <ToolsVideoCompareViewer
                :before-url="selectedTask.sourceVideoUrl"
                :after-url="selectedTask.savedVideoUrl || selectedTask.resultVideoUrl"
                before-label="原视频"
                :after-label="selectedTask.savedVideoUrl ? '已保存结果' : '字幕擦除结果'"
                empty-label="暂无预览"
              />
              <div class="flex flex-wrap gap-2">
                <Button
                  :disabled="downloading"
                  class="active:scale-[0.96] transition-transform"
                  @click="downloadResult"
                >
                  <Loader2 v-if="downloading" class="mr-2 h-4 w-4 animate-spin" />
                  <Download v-else class="mr-2 h-4 w-4" />
                  下载结果
                </Button>
                <Button
                  variant="outline"
                  :disabled="saving || Boolean(selectedTask.savedVideoUrl)"
                  class="active:scale-[0.96] transition-transform"
                  @click="saveResult"
                >
                  <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
                  <Check v-else-if="selectedTask.savedVideoUrl" class="mr-2 h-4 w-4 text-emerald-500" />
                  <Save v-else class="mr-2 h-4 w-4" />
                  {{ selectedTask.savedVideoUrl ? '已保存到素材存储' : '保存到素材存储' }}
                </Button>
              </div>
            </template>
          </div>

          <div v-else class="flex min-h-[520px] flex-col items-center justify-center px-6 text-center">
            <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <History class="h-6 w-6 text-muted-foreground" />
            </span>
            <p class="mt-4 text-sm font-medium">选择一条任务查看详情</p>
            <p class="mt-1 text-xs text-muted-foreground">完成后可在这里对比、保存和下载结果。</p>
          </div>
        </section>
      </div>
    </AppPageContent>
  </div>
</template>
