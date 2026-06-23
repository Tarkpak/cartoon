<script setup lang="ts">
import { CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw, Save, Trash2, WandSparkles } from 'lucide-vue-next'

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

const taskId = ref('')
const status = ref<TaskStatus>('idle')
const rawStatus = ref('')
const resultVideoUrl = ref('')
const localVideoUrl = ref('')
const errorMessage = ref('')
const querying = ref(false)
const saving = ref(false)
const deletingAsset = ref('')
const recentTasks = ref<VideoEnhanceTaskRecord[]>([])
let pollingTimer: number | null = null

const canQuery = computed(() => taskId.value.trim().length > 0 && !querying.value)
const canSave = computed(() => resultVideoUrl.value && !localVideoUrl.value && !saving.value)

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
  try {
    const response = await $fetch<VideoEnhanceTasksResponse>('/api/tools/video-enhance/tasks', {
      query: { limit: 100 }
    })
    recentTasks.value = response.data.tasks
  } catch (error) {
    recentTasks.value = []
    errorMessage.value = error instanceof Error ? error.message : '读取画质增强任务失败'
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
  resultVideoUrl.value = record.resultVideoUrl || ''
  localVideoUrl.value = record.savedVideoUrl || ''
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
    void loadRecentTasks()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存增强后视频失败'
  } finally {
    saving.value = false
  }
}

async function deleteTaskAsset(record: VideoEnhanceTaskRecord, asset: 'source' | 'result') {
  const key = `${record.taskId}:${asset}`
  deletingAsset.value = key
  errorMessage.value = ''
  try {
    await $fetch(`/api/tools/video-enhance/tasks/${encodeURIComponent(record.taskId)}/${asset}`, {
      method: 'DELETE'
    })
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
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
</script>

<template>
  <div class="min-h-screen bg-background p-6 lg:p-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <div class="flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div class="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <WandSparkles class="h-4 w-4" />
            工具
          </div>
          <h1 class="text-2xl font-semibold text-foreground">
            画质增强任务
          </h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            查询火山引擎 AI MediaKit 画质增强任务状态，完成后保存结果视频。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          as-child
        >
          <NuxtLink to="/tools/video-enhance">
            提交增强
          </NuxtLink>
        </Button>
      </div>

      <div class="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle class="text-lg">
              任务列表
            </CardTitle>
            <CardDescription>
              后端持久化的画质增强任务。
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <Button
              variant="outline"
              size="sm"
              class="w-full"
              @click="loadRecentTasks"
            >
              <RefreshCw class="mr-2 h-4 w-4" />
              刷新列表
            </Button>
            <div
              v-if="recentTasks.length === 0"
              class="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
            >
              暂无最近任务。
            </div>
            <div
              v-else
              class="space-y-2"
            >
              <div
                v-for="record in recentTasks"
                :key="record.taskId"
                class="rounded-md border p-3 transition-colors"
                :class="taskId === record.taskId ? 'border-primary bg-primary/5' : 'border-border'"
              >
                <button
                  type="button"
                  class="w-full text-left"
                  @click="selectTask(record)"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="truncate text-sm font-medium text-foreground">
                      {{ record.fileName }}
                    </div>
                    <div class="shrink-0 text-xs text-muted-foreground">
                      {{ record.kindLabel }}
                    </div>
                  </div>
                  <div class="mt-1 flex items-center justify-between gap-3">
                    <div class="truncate font-mono text-xs text-muted-foreground">
                      {{ record.taskId }}
                    </div>
                    <div class="shrink-0 text-xs text-muted-foreground">
                      {{ record.rawStatus || record.status }}
                    </div>
                  </div>
                  <div class="mt-1 text-xs text-muted-foreground">
                    {{ formatDate(record.createdAt) }}
                  </div>
                </button>
                <div class="mt-3 flex flex-wrap gap-2">
                  <Button
                    v-if="record.sourceObjectKey && !record.sourceDeleted"
                    variant="outline"
                    size="sm"
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
                    variant="outline"
                    size="sm"
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-lg">
              任务状态
            </CardTitle>
            <CardDescription>
              任务处理中可保持自动轮询，也可以手动刷新。
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row">
              <Input
                v-model="taskId"
                placeholder="输入 task_id"
                class="font-mono"
              />
              <Button
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

            <div class="grid gap-3 md:grid-cols-2">
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
                  <span>{{ rawStatus || status }}</span>
                </div>
              </div>
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
              <video
                :src="localVideoUrl || resultVideoUrl"
                controls
                class="aspect-video w-full rounded-md border bg-black"
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
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
