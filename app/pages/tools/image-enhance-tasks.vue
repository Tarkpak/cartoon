<script setup lang="ts">
import { Copy, ExternalLink, FileImage, Loader2, RefreshCw, Save, Trash2 } from 'lucide-vue-next'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

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
const sourceImageUrl = ref('')
const sourceDeleted = ref(false)
const resultImageUrl = ref('')
const localImageUrl = ref('')
const resultDeleted = ref(false)
const errorMessage = ref('')
const querying = ref(false)
const saving = ref(false)
const loadingTasks = ref(false)
const deletingAsset = ref('')
const recentTasks = ref<ImageEnhanceTaskRecord[]>([])
let pollingTimer: number | null = null

const embeddedInUnifiedTasks = computed(() => route.path === '/tools/enhance-tasks')
const canSave = computed(() => resultImageUrl.value && !localImageUrl.value && !saving.value)
const pollingActive = computed(() => status.value === 'processing' && pollingTimer !== null)
const displayResultImageUrl = computed(() => localImageUrl.value || resultImageUrl.value)
const compareSourceImageUrl = computed(() => sourceDeleted.value ? '' : sourceImageUrl.value)
const compareResultImageUrl = computed(() => resultDeleted.value ? '' : displayResultImageUrl.value)

onMounted(() => {
  void loadRecentTasks()
  const queryType = getSingleQueryValue(route.query.type as string | string[] | undefined)
  if (embeddedInUnifiedTasks.value && queryType !== 'image') return
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
    syncSelectedTaskFromRecords()
  } catch (error) {
    recentTasks.value = []
    errorMessage.value = error instanceof Error ? error.message : '读取图片增强任务失败'
  } finally {
    loadingTasks.value = false
  }
}

function syncSelectedTaskFromRecords() {
  const selectedTaskId = taskId.value.trim()
  if (!selectedTaskId) return
  const selectedRecord = recentTasks.value.find(record => record.taskId === selectedTaskId)
  if (!selectedRecord) return
  sourceImageUrl.value = selectedRecord.sourceImageUrl || sourceImageUrl.value
  sourceDeleted.value = selectedRecord.sourceDeleted
  resultDeleted.value = selectedRecord.resultDeleted
  if (!resultImageUrl.value) {
    resultImageUrl.value = selectedRecord.resultImageUrl || ''
  }
  if (!localImageUrl.value) {
    localImageUrl.value = selectedRecord.savedImageUrl || ''
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
  sourceImageUrl.value = record.sourceImageUrl || ''
  sourceDeleted.value = record.sourceDeleted
  resultImageUrl.value = record.resultImageUrl || ''
  localImageUrl.value = record.savedImageUrl || ''
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
    const response = await $fetch<EnhanceStatusResponse>(`/api/tools/image-enhance/status/${encodeURIComponent(id)}`)
    rawStatus.value = response.rawStatus || response.status
    localImageUrl.value = ''
    resultDeleted.value = false
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
    resultDeleted.value = false
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
    if (taskId.value === record.taskId) {
      if (asset === 'source') {
        sourceDeleted.value = true
      } else {
        resultDeleted.value = true
        resultImageUrl.value = ''
        localImageUrl.value = ''
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

function statusLabel(value: TaskStatus) {
  if (value === 'completed') return '已完成'
  if (value === 'failed') return '失败'
  if (value === 'processing') return '处理中'
  return '待处理'
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
      title="图片增强任务"
      description="查询火山引擎 AI MediaKit 图片增强任务，保存结果并管理源图和结果图。"
    >
      <template #actions>
        <Button variant="outline" size="sm" as-child>
          <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'image' } }">
            新建图片增强
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
          class="mt-4 flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm"
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
          class="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-6 text-destructive"
        >
          {{ errorMessage }}
        </div>
      </section>

      <section
        v-if="compareSourceImageUrl || compareResultImageUrl"
        class="space-y-3"
      >
        <ToolsImageCompareViewer
          :before-url="compareSourceImageUrl"
          :after-url="compareResultImageUrl"
          before-label="源图"
          :after-label="localImageUrl ? '已保存结果' : '云端结果'"
          empty-label="暂无结果"
        />
        <div class="flex flex-wrap justify-end gap-2">
          <Button
            v-if="resultImageUrl"
            variant="outline"
            size="sm"
            as-child
          >
            <a
              :href="resultImageUrl"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink class="mr-2 h-4 w-4" />
              打开云端结果
            </a>
          </Button>
          <Button
            v-if="localImageUrl"
            variant="outline"
            size="sm"
            as-child
          >
            <a
              :href="localImageUrl"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink class="mr-2 h-4 w-4" />
              打开已保存图片
            </a>
          </Button>
          <Button
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
            保存结果
          </Button>
        </div>
      </section>

      <section class="space-y-3">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-foreground">
              任务列表
            </h2>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
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

        <div
          v-if="recentTasks.length === 0"
          class="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/10 p-8 text-center"
        >
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FileImage class="h-6 w-6" />
          </div>
          <div class="mt-4 text-base font-semibold text-foreground">
            暂无增强任务
          </div>
          <div class="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
            提交图片增强后，任务会出现在这里。
          </div>
          <Button
            size="sm"
            class="mt-4"
            as-child
          >
            <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'image' } }">
              提交增强
            </NuxtLink>
          </Button>
        </div>
        <div
          v-else
          class="overflow-hidden rounded-lg border bg-background"
        >
          <div class="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_120px_120px_160px] gap-4 border-b bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
            <div>文件</div>
            <div>任务 ID</div>
            <div>类型</div>
            <div>状态</div>
            <div class="text-right">操作</div>
          </div>
          <div
            v-for="record in recentTasks"
            :key="record.id"
            class="grid gap-3 border-b p-4 transition-colors last:border-b-0 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_120px_120px_160px] lg:items-center"
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
            </button>
            <div>
              <Badge variant="outline">
                {{ record.kindLabel }}
              </Badge>
            </div>
            <div>
              <Badge :variant="taskStatusVariant(record.status)">
                {{ statusLabel(record.status) }}
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
    </AppPageContent>
  </div>
</template>
