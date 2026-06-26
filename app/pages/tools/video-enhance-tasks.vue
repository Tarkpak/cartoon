<script setup lang="ts">
import { AlertCircle, CheckCircle2, Clock3, Copy, ExternalLink, FileVideo, Loader2, RefreshCw, Save, Trash2 } from 'lucide-vue-next'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

definePageMeta({
  layout: 'default'
})

type EnhanceKind = 'standard' | 'professional' | 'fast' | 'generative'
type TaskStatus = 'idle' | 'processing' | 'completed' | 'failed'

interface EnhanceStatusResponse {
  success: boolean
  taskId: string
  status: 'processing' | 'completed' | 'failed'
  rawStatus?: string
  videoUrl?: string | null
}

interface EnhanceSaveResponse {
  success: boolean
  videoUrl: string
}

interface VideoEnhanceTaskRecord {
  id: string
  taskId: string
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
const loadingTasks = ref(false)
const deletingAsset = ref('')
const recentTasks = ref<VideoEnhanceTaskRecord[]>([])
let pollingTimer: number | null = null

const embeddedInUnifiedTasks = computed(() => route.path === '/tools/enhance-tasks')
const canQuery = computed(() => taskId.value.trim().length > 0 && !querying.value)
const canSave = computed(() => resultVideoUrl.value && !localVideoUrl.value && !saving.value)
const pollingActive = computed(() => status.value === 'processing' && pollingTimer !== null)
const displayResultVideoUrl = computed(() => localVideoUrl.value || resultVideoUrl.value)
const compareSourceVideoUrl = computed(() => sourceDeleted.value ? '' : sourceVideoUrl.value)
const compareResultVideoUrl = computed(() => resultDeleted.value ? '' : displayResultVideoUrl.value)

onMounted(() => {
  void loadRecentTasks()
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
      query: { limit: 100 }
    })
    recentTasks.value = response.data.tasks
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
  if (!id) return

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
      errorMessage.value = '火山引擎任务处理失败，请检查任务 ID 或模型日志。'
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

async function saveResult() {
  if (!resultVideoUrl.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<EnhanceSaveResponse>('/api/tools/video-enhance/save', {
      method: 'POST',
      body: { taskId: taskId.value, videoUrl: resultVideoUrl.value }
    })
    localVideoUrl.value = response.videoUrl
    resultDeleted.value = false
    toast.success('结果视频已保存')
    void loadRecentTasks()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存增强后视频失败'
  } finally {
    saving.value = false
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
          <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'video' } }">
            提交增强
          </NuxtLink>
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent scroll inner-class="space-y-6">
      <Card>
        <CardHeader class="border-b">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle class="text-lg">
                任务工作区
              </CardTitle>
              <CardDescription>
                查询任务状态，查看历史任务，并在完成后保存或清理视频文件。
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              :disabled="loadingTasks"
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
          </div>
        </CardHeader>
        <CardContent class="space-y-6 pt-6">
          <section class="space-y-4">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="text-base font-semibold text-foreground">
                  任务状态
                </h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  选择列表中的任务，或手动输入 task_id 查询。
                </p>
              </div>
            </div>

            <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px_220px]">
              <div class="flex gap-3">
                <Input
                  v-model="taskId"
                  placeholder="输入 task_id"
                  class="font-mono"
                />
                <Button
                  class="shrink-0"
                  :disabled="!canQuery"
                  @click="queryStatus(true)"
                >
                  <Loader2
                    v-if="querying"
                    class="mr-2 h-4 w-4 animate-spin"
                  />
                  <RefreshCw
                    v-else
                    class="mr-2 h-4 w-4"
                  />
                  查询
                </Button>
              </div>

              <div class="rounded-md border bg-muted/30 p-3">
                <div class="text-xs text-muted-foreground">
                  任务 ID
                </div>
                <div class="mt-1 flex items-center gap-2">
                  <code class="min-w-0 flex-1 truncate text-sm">{{ taskId || '未选择' }}</code>
                  <Button
                    v-if="taskId"
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    @click="copyText(taskId)"
                  >
                    <Copy class="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div class="rounded-md border bg-muted/30 p-3">
                <div class="text-xs text-muted-foreground">
                  状态
                </div>
                <div class="mt-1 flex items-center gap-2 text-sm font-medium">
                  <Loader2
                    v-if="querying || status === 'processing'"
                    class="h-4 w-4 animate-spin text-primary"
                  />
                  <CheckCircle2
                    v-else-if="status === 'completed'"
                    class="h-4 w-4 text-green-600"
                  />
                  <AlertCircle
                    v-else-if="status === 'failed'"
                    class="h-4 w-4 text-destructive"
                  />
                  <Clock3
                    v-else
                    class="h-4 w-4 text-muted-foreground"
                  />
                  <Badge :variant="taskStatusVariant(status)">
                    {{ taskStatusLabel(status) }}
                  </Badge>
                  <span
                    v-if="rawStatus && rawStatus !== status"
                    class="text-xs text-muted-foreground"
                  >
                    {{ rawStatus }}
                  </span>
                </div>
              </div>
            </div>

            <div
              v-if="pollingActive"
              class="flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm"
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
              class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-6 text-destructive"
            >
              {{ errorMessage }}
            </div>

            <div
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
              </div>
              <div
                v-if="localVideoUrl"
                class="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-200"
              >
                已保存：{{ localVideoUrl }}
              </div>
            </div>
          </section>

          <section class="space-y-3 border-t pt-6">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="text-base font-semibold text-foreground">
                  任务列表
                </h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  后端持久化的画质增强任务，点击任一任务即可查询状态。
                </p>
              </div>
            </div>

            <div
              v-if="recentTasks.length === 0"
              class="rounded-md border border-dashed p-8 text-center"
            >
              <FileVideo class="mx-auto h-8 w-8 text-muted-foreground/70" />
              <div class="mt-3 text-sm font-medium text-foreground">
                暂无增强任务
              </div>
              <div class="mt-1 text-xs leading-5 text-muted-foreground">
                提交视频增强后，任务会出现在这里。
              </div>
              <Button
                variant="outline"
                size="sm"
                class="mt-4"
                as-child
              >
                <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'video' } }">
                  提交增强
                </NuxtLink>
              </Button>
            </div>
            <div
              v-else
              class="divide-y rounded-md border"
            >
              <div
                v-for="record in recentTasks"
                :key="record.taskId"
                class="grid gap-3 p-4 transition-colors lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_160px_auto]"
                :class="taskId === record.taskId ? 'bg-primary/5' : 'hover:bg-muted/30'"
              >
                <button
                  type="button"
                  class="min-w-0 text-left"
                  @click="selectTask(record)"
                >
                  <div class="truncate text-sm font-medium text-foreground">
                    {{ record.fileName }}
                  </div>
                  <div class="mt-1 text-xs text-muted-foreground">
                    {{ formatDate(record.createdAt) }}
                  </div>
                </button>
                <button
                  type="button"
                  class="min-w-0 text-left"
                  @click="selectTask(record)"
                >
                  <div class="truncate font-mono text-xs text-muted-foreground">
                    {{ record.taskId }}
                  </div>
                  <div class="mt-1 text-xs text-muted-foreground">
                    {{ record.rawStatus || taskStatusLabel(record.status) }}
                  </div>
                </button>
                <div class="flex items-start gap-2">
                  <Badge variant="outline">
                    {{ record.kindLabel }}
                  </Badge>
                  <Badge :variant="taskStatusVariant(record.status)">
                    {{ taskStatusLabel(record.status) }}
                  </Badge>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <Button
                    v-if="record.sourceObjectKey && !record.sourceDeleted"
                    variant="ghost"
                    size="sm"
                    class="text-destructive hover:text-destructive"
                    :disabled="deletingAsset === `${record.taskId}:source`"
                    @click="deleteTaskAsset(record, 'source')"
                  >
                    <Loader2
                      v-if="deletingAsset === `${record.taskId}:source`"
                      class="mr-2 h-4 w-4 animate-spin"
                    />
                    <Trash2
                      v-else
                      class="mr-2 h-4 w-4"
                    />
                    删除源
                  </Button>
                  <Button
                    v-if="record.resultObjectKey && !record.resultDeleted"
                    variant="ghost"
                    size="sm"
                    class="text-destructive hover:text-destructive"
                    :disabled="deletingAsset === `${record.taskId}:result`"
                    @click="deleteTaskAsset(record, 'result')"
                  >
                    <Loader2
                      v-if="deletingAsset === `${record.taskId}:result`"
                      class="mr-2 h-4 w-4 animate-spin"
                    />
                    <Trash2
                      v-else
                      class="mr-2 h-4 w-4"
                    />
                    删除结果
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </CardContent>
      </Card>
    </AppPageContent>
  </div>
</template>
