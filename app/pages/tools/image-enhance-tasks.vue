<script setup lang="ts">
import { AlertCircle, CheckCircle2, Clock3, Copy, ExternalLink, FileImage, Loader2, RefreshCw, Save, Trash2, WandSparkles } from 'lucide-vue-next'

definePageMeta({
  layout: 'default'
})

type EnhanceKind = 'standard' | 'portrait' | 'old_photo' | 'upscale'
type TaskStatus = 'idle' | 'processing' | 'completed' | 'failed'

interface EnhanceStatusResponse {
  success: boolean
  taskId: string
  status: 'processing' | 'completed' | 'failed'
  rawStatus?: string
  imageUrl?: string | null
}

interface EnhanceSaveResponse {
  success: boolean
  imageUrl: string
}

interface ImageEnhanceTaskRecord {
  id: string
  taskId: string
  kind: EnhanceKind
  kindLabel: string
  fileName: string
  sourceImageUrl: string
  sourceObjectKey?: string | null
  sourceDeleted: boolean
  resultImageUrl?: string | null
  savedImageUrl?: string | null
  resultObjectKey?: string | null
  resultDeleted: boolean
  status: TaskStatus
  rawStatus?: string | null
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
  completedAt?: string | null
}

interface ImageEnhanceTasksResponse {
  success: boolean
  data: {
    tasks: ImageEnhanceTaskRecord[]
  }
}

const route = useRoute()
const { toast } = useToast()
const { confirm } = useConfirm()

const taskId = ref('')
const status = ref<TaskStatus>('idle')
const rawStatus = ref('')
const resultImageUrl = ref('')
const localImageUrl = ref('')
const errorMessage = ref('')
const querying = ref(false)
const saving = ref(false)
const loadingTasks = ref(false)
const deletingAsset = ref('')
const recentTasks = ref<ImageEnhanceTaskRecord[]>([])
let pollingTimer: number | null = null

const embeddedInUnifiedTasks = computed(() => route.path === '/tools/enhance-tasks')
const canQuery = computed(() => taskId.value.trim().length > 0 && !querying.value)
const canSave = computed(() => resultImageUrl.value && !localImageUrl.value && !saving.value)
const pollingActive = computed(() => status.value === 'processing' && pollingTimer !== null)

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
    const response = await $fetch<ImageEnhanceTasksResponse>('/api/tools/image-enhance/tasks', {
      query: { limit: 100 }
    })
    recentTasks.value = response.data.tasks
  } catch (error) {
    recentTasks.value = []
    errorMessage.value = error instanceof Error ? error.message : '读取图片增强任务失败'
  } finally {
    loadingTasks.value = false
  }
}

function stopPolling() {
  if (pollingTimer) {
    window.clearTimeout(pollingTimer)
    pollingTimer = null
  }
}

function selectTask(record: ImageEnhanceTaskRecord) {
  taskId.value = record.taskId
  status.value = record.status
  rawStatus.value = record.rawStatus || record.status
  resultImageUrl.value = record.resultImageUrl || ''
  localImageUrl.value = record.savedImageUrl || ''
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
    const response = await $fetch<EnhanceStatusResponse>(`/api/tools/image-enhance/status/${encodeURIComponent(id)}`)
    rawStatus.value = response.rawStatus || response.status
    localImageUrl.value = ''
    if (response.status === 'completed') {
      status.value = 'completed'
      resultImageUrl.value = response.imageUrl || ''
      void loadRecentTasks()
      return
    }
    if (response.status === 'failed') {
      status.value = 'failed'
      resultImageUrl.value = ''
      errorMessage.value = '火山引擎图片增强任务处理失败，请检查任务 ID 或模型日志。'
      void loadRecentTasks()
      return
    }
    status.value = 'processing'
    resultImageUrl.value = ''
    if (autoPoll) {
      pollingTimer = window.setTimeout(() => {
        void queryStatus(true)
      }, 10000)
    }
    void loadRecentTasks()
  } catch (error) {
    status.value = 'failed'
    resultImageUrl.value = ''
    errorMessage.value = error instanceof Error ? error.message : '查询图片增强任务失败'
  } finally {
    querying.value = false
  }
}

async function saveResult() {
  if (!resultImageUrl.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<EnhanceSaveResponse>('/api/tools/image-enhance/save', {
      method: 'POST',
      body: { taskId: taskId.value, imageUrl: resultImageUrl.value }
    })
    localImageUrl.value = response.imageUrl
    toast.success('结果图片已保存')
    void loadRecentTasks()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存增强后图片失败'
  } finally {
    saving.value = false
  }
}

async function deleteTaskAsset(record: ImageEnhanceTaskRecord, asset: 'source' | 'result') {
  const confirmed = await confirm({
    title: asset === 'source' ? '删除源图片？' : '删除结果图片？',
    description: asset === 'source'
      ? `将从存储中删除「${record.fileName}」的源图片文件，任务记录会保留。`
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
    await $fetch(`/api/tools/image-enhance/tasks/${encodeURIComponent(record.taskId)}/${asset}`, {
      method: 'DELETE'
    })
    toast.success(asset === 'source' ? '源图片已删除' : '结果图片已删除')
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

function statusLabel(value: TaskStatus) {
  if (value === 'completed') return '已完成'
  if (value === 'failed') return '失败'
  if (value === 'processing') return '处理中'
  return '待处理'
}
</script>

<template>
  <div class="min-h-screen bg-background p-6 lg:p-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <div
        v-if="!embeddedInUnifiedTasks"
        class="flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between"
      >
        <div>
          <div class="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <WandSparkles class="h-4 w-4" />
            工具
          </div>
          <h1 class="text-2xl font-semibold text-foreground">
            图片增强任务
          </h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            查询火山引擎 AI MediaKit 图片增强任务，保存结果并管理源图和结果图。
          </p>
        </div>
        <Button variant="outline" size="sm" as-child>
          <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'image' } }">
            新建图片增强
          </NuxtLink>
        </Button>
      </div>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader class="border-b">
            <CardTitle class="text-lg">
              任务查询
            </CardTitle>
            <CardDescription>
              粘贴任务 ID 或从右侧任务列表选择。
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-5 pt-6">
            <div class="flex gap-2">
              <Input v-model="taskId" placeholder="MediaKit task_id" />
              <Button :disabled="!canQuery" @click="queryStatus(true)">
                <Loader2 v-if="querying" class="mr-2 h-4 w-4 animate-spin" />
                <RefreshCw v-else class="mr-2 h-4 w-4" />
                查询
              </Button>
            </div>
            <Alert v-if="errorMessage" variant="destructive">
              <AlertCircle class="h-4 w-4" />
              <AlertDescription>{{ errorMessage }}</AlertDescription>
            </Alert>
            <div class="rounded-md border bg-muted/20 p-4">
              <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <CheckCircle2 v-if="status === 'completed'" class="h-4 w-4 text-green-600" />
                  <AlertCircle v-else-if="status === 'failed'" class="h-4 w-4 text-destructive" />
                  <Clock3 v-else class="h-4 w-4 text-muted-foreground" />
                  <span class="text-sm font-medium text-foreground">{{ statusLabel(status) }}</span>
                  <Badge v-if="rawStatus" variant="outline">{{ rawStatus }}</Badge>
                  <Badge v-if="pollingActive" variant="secondary">自动轮询</Badge>
                </div>
                <Button v-if="taskId" variant="ghost" size="sm" @click="copyText(taskId)">
                  <Copy class="mr-2 h-4 w-4" />
                  复制
                </Button>
              </div>
              <div class="grid gap-4 md:grid-cols-2">
                <div>
                  <div class="mb-2 text-xs font-medium text-muted-foreground">
                    云端结果
                  </div>
                  <div class="flex min-h-[260px] items-center justify-center rounded-md bg-background">
                    <img
                      v-if="resultImageUrl"
                      :src="resultImageUrl"
                      alt="云端增强结果"
                      class="max-h-[420px] max-w-full rounded-md object-contain"
                    >
                    <span v-else class="text-sm text-muted-foreground">暂无结果</span>
                  </div>
                </div>
                <div>
                  <div class="mb-2 text-xs font-medium text-muted-foreground">
                    已保存结果
                  </div>
                  <div class="flex min-h-[260px] items-center justify-center rounded-md bg-background">
                    <img
                      v-if="localImageUrl"
                      :src="localImageUrl"
                      alt="已保存结果"
                      class="max-h-[420px] max-w-full rounded-md object-contain"
                    >
                    <span v-else class="text-sm text-muted-foreground">保存后在这里预览</span>
                  </div>
                </div>
              </div>
              <div class="mt-4 flex flex-wrap justify-end gap-2">
                <Button v-if="resultImageUrl" variant="outline" as-child>
                  <a :href="resultImageUrl" target="_blank" rel="noreferrer">
                    <ExternalLink class="mr-2 h-4 w-4" />
                    打开云端结果
                  </a>
                </Button>
                <Button v-if="localImageUrl" variant="outline" as-child>
                  <a :href="localImageUrl" target="_blank" rel="noreferrer">
                    <ExternalLink class="mr-2 h-4 w-4" />
                    打开已保存图片
                  </a>
                </Button>
                <Button :disabled="!canSave" @click="saveResult">
                  <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
                  <Save v-else class="mr-2 h-4 w-4" />
                  保存结果
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="border-b">
            <CardTitle class="text-lg">
              最近任务
            </CardTitle>
            <CardDescription>
              本地记录的图片增强任务。
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-3 pt-4">
            <div v-if="loadingTasks" class="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 class="h-4 w-4 animate-spin" />
              正在加载任务
            </div>
            <div v-else-if="recentTasks.length === 0" class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              暂无图片增强任务
            </div>
            <button
              v-for="record in recentTasks"
              :key="record.id"
              type="button"
              class="w-full rounded-md border p-3 text-left transition-colors hover:bg-accent"
              :class="taskId === record.taskId ? 'border-primary bg-primary/5' : 'border-border'"
              @click="selectTask(record)"
            >
              <div class="flex items-start gap-3">
                <FileImage class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium text-foreground">
                    {{ record.fileName }}
                  </div>
                  <div class="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{{ record.kindLabel }}</span>
                    <span>{{ statusLabel(record.status) }}</span>
                    <span>{{ formatDate(record.createdAt) }}</span>
                  </div>
                  <div class="mt-2 truncate text-xs text-muted-foreground">
                    {{ record.taskId }}
                  </div>
                </div>
              </div>
              <div class="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="record.sourceDeleted || !record.sourceObjectKey || deletingAsset === `${record.taskId}:source`"
                  @click.stop="deleteTaskAsset(record, 'source')"
                >
                  <Loader2 v-if="deletingAsset === `${record.taskId}:source`" class="mr-2 h-3.5 w-3.5 animate-spin" />
                  <Trash2 v-else class="mr-2 h-3.5 w-3.5" />
                  源图
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="record.resultDeleted || !record.resultObjectKey || deletingAsset === `${record.taskId}:result`"
                  @click.stop="deleteTaskAsset(record, 'result')"
                >
                  <Loader2 v-if="deletingAsset === `${record.taskId}:result`" class="mr-2 h-3.5 w-3.5 animate-spin" />
                  <Trash2 v-else class="mr-2 h-3.5 w-3.5" />
                  结果
                </Button>
              </div>
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
