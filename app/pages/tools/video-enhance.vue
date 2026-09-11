<script setup lang="ts">
import { ChevronDown, ExternalLink, FileVideo, FolderOpen, ListChecks, Loader2, Settings, Trash2, Upload } from 'lucide-vue-next'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

definePageMeta({
  layout: 'default'
})

type EnhanceKind = 'standard' | 'professional' | 'fast' | 'generative'

interface EnhanceSubmitResponse {
  success: boolean
  taskId: string
}

interface EnhanceUploadResponse {
  success: boolean
  videoUrl: string
  sourceObjectKey?: string
  reused?: boolean
}

interface VideoEnhanceBatchSettings {
  kind: EnhanceKind
  scene: string
  resolution: string
  resolutionLimit: number
  fps?: number
  resolutionMode: 'preset' | 'limit'
}

type QueueStatus = 'pending' | 'uploading' | 'uploaded' | 'submitting' | 'submitted' | 'failed'

interface VideoEnhanceQueueItem {
  id: string
  file: File
  fileName: string
  fileSize: number
  fileType: string
  sourceVideoUrl: string
  sourceObjectKey: string
  uploadProgress: number
  status: QueueStatus
  taskId: string
  errorMessage: string
  reused: boolean
}

type FetchErrorWithData = Error & {
  data?: {
    data?: {
      message?: string
    }
    message?: string
    statusMessage?: string
  }
}

const router = useRouter()
const { toast } = useToast()
const { confirm } = useConfirm()

const kind = ref<EnhanceKind>('standard')
const queue = ref<VideoEnhanceQueueItem[]>([])
const scene = ref('short_series')
const resolution = ref('1080p')
const resolutionLimit = ref(1080)
const fps = ref<number | undefined>(undefined)
const resolutionMode = ref<'preset' | 'limit'>('preset')
const submitting = ref(false)
const uploadingSource = ref(false)
const errorMessage = ref('')
const showAdvancedOptions = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const folderInputRef = ref<HTMLInputElement | null>(null)
const draggingFiles = ref(false)
const batchId = ref('')
const lockedBatchSettings = ref<VideoEnhanceBatchSettings | null>(null)

const fileNameCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
})

const route = useRoute()
const embeddedInUnifiedEnhance = computed(() => route.path === '/tools/enhance')

const kindOptions: Array<{
  value: EnhanceKind
  label: string
  description: string
  speed: string
  cost: string
  bestFor: string
  limit: string
}> = [
  {
    value: 'standard',
    label: '标准版',
    description: '平衡处理速度、画质和成本，适合常规分发。',
    speed: '常规',
    cost: '中',
    bestFor: '短剧、AIGC、常规素材',
    limit: '支持最高 4K'
  },
  {
    value: 'professional',
    label: '专业版',
    description: '投入更多算力，适合老片修复和高质量交付。',
    speed: '较慢',
    cost: '高',
    bestFor: '老片修复、高质量交付',
    limit: '支持最高 4K'
  },
  {
    value: 'fast',
    label: '极速版',
    description: '速度优先，适合直播、短视频等时效场景。',
    speed: '快',
    cost: '低',
    bestFor: '直播切片、UGC 短视频',
    limit: '支持最高 4K'
  },
  {
    value: 'generative',
    label: '大模型',
    description: '生成式增强修复，适合低清修复和细节补全。',
    speed: '慢',
    cost: '高',
    bestFor: '低清修复、细节补全',
    limit: '输入最高 1080p，SDR'
  }
]

const sceneOptions = [
  { value: 'common', label: '通用' },
  { value: 'aigc', label: 'AIGC' },
  { value: 'short_series', label: '短剧' },
  { value: 'ugc', label: 'UGC 短视频' },
  { value: 'old_film', label: '老片修复' }
]

const resolutionOptions = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' }
]

const normalizedFps = computed(() => {
  if (fps.value === undefined || fps.value === null) return undefined
  const value = Number(fps.value)
  return Number.isFinite(value) ? value : undefined
})
const fpsValid = computed(() => normalizedFps.value === undefined || (normalizedFps.value >= 15 && normalizedFps.value <= 120))
const activeQueue = computed(() => uploadingSource.value || submitting.value)
const parametersLocked = computed(() => activeQueue.value || lockedBatchSettings.value !== null)
const pendingQueue = computed(() => queue.value.filter(item => item.status !== 'submitted'))
const submittedQueue = computed(() => queue.value.filter(item => item.status === 'submitted'))
const failedQueue = computed(() => queue.value.filter(item => item.status === 'failed'))
const processedQueueCount = computed(() => submittedQueue.value.length + failedQueue.value.length)
const totalQueueBytes = computed(() => queue.value.reduce((total, item) => total + item.fileSize, 0))
const batchProgress = computed(() => {
  if (queue.value.length === 0) return 0
  const activeItem = queue.value.find(item => item.status === 'uploading' || item.status === 'submitting')
  const activeProgress = activeItem?.status === 'uploading' ? activeItem.uploadProgress / 100 : activeItem ? 1 : 0
  return Math.round(((processedQueueCount.value + activeProgress) / queue.value.length) * 100)
})
const canSubmit = computed(() => queue.value.length > 0 && pendingQueue.value.length > 0 && !activeQueue.value && fpsValid.value)
const submitButtonLabel = computed(() => {
  if (activeQueue.value) return `批量处理中 ${processedQueueCount.value}/${queue.value.length}`
  if (failedQueue.value.length > 0 && pendingQueue.value.length === failedQueue.value.length) {
    return `重试 ${failedQueue.value.length} 个失败任务`
  }
  return `提交 ${pendingQueue.value.length} 个增强任务`
})
const submitHint = computed(() => {
  if (submitting.value) return '正在提交任务，请稍候。'
  if (uploadingSource.value) return '源视频正在上传，请稍候。'
  if (queue.value.length === 0) return '请选择一个或多个本地视频。'
  if (!fpsValid.value) return '帧率需在 15-120 fps 之间。'
  return ''
})
const selectedKindOption = computed(() => kindOptions.find(option => option.value === kind.value))
const selectedSceneLabel = computed(() => sceneOptions.find(option => option.value === scene.value)?.label || scene.value)
const resolutionSummary = computed(() => resolutionMode.value === 'limit' ? `短边 ${resolutionLimit.value}px` : resolution.value.toUpperCase())
const selectedDocsUrl = computed(() => {
  switch (kind.value) {
    case 'fast':
      return 'https://www.volcengine.com/docs/6448/2487478?lang=zh'
    case 'generative':
      return 'https://www.volcengine.com/docs/6448/2464595?lang=zh'
    default:
      return 'https://www.volcengine.com/docs/6448/2279230?lang=zh'
  }
})
const supportsResolutionLimit = computed(() => kind.value !== 'generative')

watch(kind, (value) => {
  if (value === 'generative') {
    resolutionMode.value = 'preset'
    if (resolution.value === '480p' || resolution.value === '4k') resolution.value = '1080p'
  }
})

function createQueueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createBatchSettings(): VideoEnhanceBatchSettings {
  return {
    kind: kind.value,
    scene: scene.value,
    resolution: resolution.value,
    resolutionLimit: resolutionLimit.value,
    fps: normalizedFps.value,
    resolutionMode: resolutionMode.value
  }
}

function buildRequestBody(item: VideoEnhanceQueueItem, settings: VideoEnhanceBatchSettings, currentBatchId: string) {
  const body: Record<string, unknown> = {
    batchId: currentBatchId,
    kind: settings.kind,
    videoUrl: item.sourceVideoUrl.trim(),
    sourceFileName: item.fileName || '本地视频',
    sourceObjectKey: item.sourceObjectKey || undefined
  }
  if (settings.kind === 'standard') {
    body.scene = settings.scene
  }
  if (settings.kind !== 'generative' && settings.resolutionMode === 'limit') {
    body.resolutionLimit = settings.resolutionLimit
  } else {
    body.resolution = settings.resolution
  }
  if (settings.fps !== undefined) {
    body.fps = settings.fps
  }
  return body
}

function triggerFileUpload() {
  fileInputRef.value?.click()
}

function triggerFolderUpload() {
  folderInputRef.value?.click()
}

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)
}

function addFilesToQueue(files: File[]) {
  const videoFiles = files.filter(isVideoFile)
  if (videoFiles.length === 0) {
    errorMessage.value = '请拖入视频文件。'
    return
  }
  const existingFiles = new Set(queue.value.map(item => `${item.fileName}:${item.fileSize}:${item.file.lastModified}`))
  const uniqueVideoFiles = videoFiles.filter((file) => {
    const signature = `${file.name}:${file.size}:${file.lastModified}`
    if (existingFiles.has(signature)) return false
    existingFiles.add(signature)
    return true
  })

  if (uniqueVideoFiles.length === 0) {
    toast.warning('所选视频已在当前批次中')
    return
  }

  errorMessage.value = ''
  queue.value.push(...uniqueVideoFiles.map(file => ({
    id: createQueueId(),
    file,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type || '视频文件',
    sourceVideoUrl: '',
    sourceObjectKey: '',
    uploadProgress: 0,
    status: 'pending' as QueueStatus,
    taskId: '',
    errorMessage: '',
    reused: false
  })))
  queue.value.sort((left, right) => fileNameCollator.compare(left.fileName, right.fileName))

  if (videoFiles.length < files.length) {
    toast.warning(`已忽略 ${files.length - videoFiles.length} 个非视频文件`)
  }
  const duplicateCount = videoFiles.length - uniqueVideoFiles.length
  if (duplicateCount > 0) {
    toast.warning(`已忽略 ${duplicateCount} 个重复视频`)
  }
}

function formatBytes(value: number) {
  if (!value) return '未知大小'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

function uploadSourceVideo(formData: FormData, onProgress: (progress: number) => void): Promise<EnhanceUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/tools/video-enhance/upload-source')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onload = () => {
      const response = xhr.response as EnhanceUploadResponse | { message?: string } | null
      if (xhr.status >= 200 && xhr.status < 300 && response && 'videoUrl' in response) {
        onProgress(100)
        resolve(response)
        return
      }
      reject(new Error(response && 'message' in response && response.message ? response.message : '上传源视频到 TOS 失败'))
    }
    xhr.onerror = () => reject(new Error('上传源视频到 TOS 失败，请检查网络或 TOS 配置'))
    xhr.send(formData)
  })
}

function resolveFetchErrorMessage(error: unknown, fallback: string): string {
  const fetchError = error as FetchErrorWithData
  return fetchError.data?.data?.message
    || fetchError.data?.message
    || fetchError.data?.statusMessage
    || (error instanceof Error ? error.message : fallback)
}

async function handleSourceFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  const files = Array.from(input?.files || [])
  if (files.length > 0) addFilesToQueue(files)
  if (input) input.value = ''
}

async function handleSourceFolderChange(event: Event) {
  await handleSourceFileChange(event)
}

function handleDragEnter(event: DragEvent) {
  if (parametersLocked.value || !event.dataTransfer?.types.includes('Files')) return
  draggingFiles.value = true
}

function handleDragLeave(event: DragEvent) {
  const currentTarget = event.currentTarget as Node | null
  const relatedTarget = event.relatedTarget as Node | null
  if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) return
  draggingFiles.value = false
}

function handleDrop(event: DragEvent) {
  draggingFiles.value = false
  if (parametersLocked.value) return
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length > 0) addFilesToQueue(files)
}

function removeQueueItem(id: string) {
  if (activeQueue.value) return
  queue.value = queue.value.filter(item => item.id !== id)
}

function clearQueue() {
  if (activeQueue.value) return
  queue.value = []
  batchId.value = ''
  lockedBatchSettings.value = null
  errorMessage.value = ''
}

async function submitQueueItem(item: VideoEnhanceQueueItem, settings: VideoEnhanceBatchSettings, currentBatchId: string) {
  item.errorMessage = ''
  if (!item.sourceVideoUrl) {
    item.status = 'uploading'
    uploadingSource.value = true
    item.uploadProgress = 0
    const formData = new FormData()
    formData.append('video', item.file, item.fileName)
    const uploadResponse = await uploadSourceVideo(formData, (progress) => {
      item.uploadProgress = progress
    })
    item.sourceVideoUrl = uploadResponse.videoUrl
    item.sourceObjectKey = uploadResponse.sourceObjectKey || ''
    item.reused = uploadResponse.reused === true
    item.status = 'uploaded'
  }

  item.status = 'submitting'
  const response = await $fetch<EnhanceSubmitResponse>('/api/tools/video-enhance', {
    method: 'POST',
    body: buildRequestBody(item, settings, currentBatchId)
  })
  item.taskId = response.taskId
  item.status = 'submitted'
}

async function submitTask() {
  errorMessage.value = ''
  const settings = lockedBatchSettings.value || createBatchSettings()
  const kindLabel = kindOptions.find(option => option.value === settings.kind)?.label || settings.kind
  const sceneLabel = settings.kind === 'standard' ? selectedSceneLabel.value : '默认'
  const fpsLabel = settings.fps === undefined ? '保持原帧率' : `${settings.fps} fps`
  const confirmed = await confirm({
    title: `提交 ${pendingQueue.value.length} 个视频增强任务？`,
    description: `${kindLabel} · ${sceneLabel} · ${resolutionSummary.value} · ${fpsLabel}。确认后整批任务将锁定使用这套参数。`,
    confirmText: '确认批量提交',
    cancelText: '返回检查'
  })
  if (!confirmed) return
  lockedBatchSettings.value = settings

  for (const item of queue.value) {
    if (item.status !== 'failed') continue
    item.status = item.sourceVideoUrl ? 'uploaded' : 'pending'
    item.errorMessage = ''
  }
  if (!batchId.value) batchId.value = `venh_batch_${crypto.randomUUID()}`
  const currentBatchId = batchId.value
  submitting.value = true
  let successCount = 0
  let failedCount = 0
  try {
    for (const item of queue.value) {
      if (item.status === 'submitted') continue
      try {
        await submitQueueItem(item, settings, currentBatchId)
        successCount += 1
      } catch (error) {
        item.status = 'failed'
        item.errorMessage = resolveFetchErrorMessage(error, '提交画质增强任务失败')
        failedCount += 1
      } finally {
        uploadingSource.value = false
      }
    }

    if (successCount > 0) {
      toast.success(`已提交 ${successCount} 个视频增强任务`)
    }
    if (failedCount > 0) {
      errorMessage.value = `${failedCount} 个任务提交失败，请检查队列中的错误信息后重试。`
      return
    }
    if (successCount > 0) {
      await router.push({
        path: '/tools/enhance',
        query: { type: 'video', view: 'tasks' }
      })
    }
  } finally {
    uploadingSource.value = false
    submitting.value = false
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!pendingQueue.value.length) return
  event.preventDefault()
  event.returnValue = ''
}

async function confirmDiscardQueue() {
  if (!pendingQueue.value.length) return true
  if (activeQueue.value) {
    toast.warning('批量任务正在上传或提交，请等待完成后再离开')
    return false
  }
  return await confirm({
    title: '离开并清空当前批次？',
    description: `当前还有 ${pendingQueue.value.length} 个视频尚未提交，离开页面后需要重新选择文件。`,
    confirmText: '离开页面',
    cancelText: '继续处理',
    variant: 'destructive'
  })
}

onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', handleBeforeUnload))
onBeforeRouteUpdate(confirmDiscardQueue)
onBeforeRouteLeave(confirmDiscardQueue)
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col bg-background">
    <AppPageHeader
      v-if="!embeddedInUnifiedEnhance"
      title="画质增强"
      description="选择本地视频上传到 TOS 后，提交到火山引擎 AI MediaKit 进行画质增强。"
    >
      <template #actions>
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            as-child
          >
            <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'video', view: 'tasks' } }">
              <ListChecks class="mr-2 h-4 w-4" />
              任务
            </NuxtLink>
          </Button>
          <Button
            variant="outline"
            size="sm"
            as-child
          >
            <a
              :href="selectedDocsUrl"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink class="mr-2 h-4 w-4" />
              文档
            </a>
          </Button>
        </div>
      </template>
    </AppPageHeader>

    <AppPageContent scroll inner-class="space-y-6">
      <Card>
        <CardContent class="space-y-5 pt-6">
          <div class="grid gap-3 md:grid-cols-4">
            <button
              v-for="option in kindOptions"
              :key="option.value"
              type="button"
              class="rounded-xl bg-muted/20 p-3 text-left transition-colors hover:bg-muted/35 disabled:cursor-not-allowed disabled:opacity-60"
              :class="kind === option.value ? 'border-primary bg-primary/5' : 'border-border'"
              :disabled="parametersLocked"
              @click="kind = option.value"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="text-sm font-medium text-foreground">
                  {{ option.label }}
                </div>
                <Badge
                  variant="outline"
                  class="shrink-0"
                >
                  {{ option.speed }}
                </Badge>
              </div>
              <div class="mt-1 text-xs leading-5 text-muted-foreground">
                {{ option.description }}
              </div>
              <div class="mt-3 grid gap-1 text-xs text-muted-foreground">
                <div class="flex justify-between gap-2">
                  <span>成本</span>
                  <span class="text-foreground">{{ option.cost }}</span>
                </div>
                <div class="flex justify-between gap-2">
                  <span>限制</span>
                  <span class="text-right text-foreground">{{ option.limit }}</span>
                </div>
              </div>
            </button>
          </div>

          <div
            class="rounded-xl bg-muted/15 bg-muted/30 p-4 transition-colors"
            :class="draggingFiles ? 'border-primary bg-primary/5' : 'border-border'"
            @dragenter.prevent="handleDragEnter"
            @dragover.prevent
            @dragleave.prevent="handleDragLeave"
            @drop.prevent="handleDrop"
          >
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div class="text-sm font-medium text-foreground">
                  本地视频
                </div>
                <div class="mt-1 text-xs text-muted-foreground">
                  支持点击选择或拖拽导入多个视频。
                </div>
              </div>
              <input
                ref="fileInputRef"
                type="file"
                multiple
                accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
                class="hidden"
                @change="handleSourceFileChange"
              >
              <input
                ref="folderInputRef"
                type="file"
                multiple
                webkitdirectory
                accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
                class="hidden"
                @change="handleSourceFolderChange"
              >
              <div class="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  :disabled="parametersLocked"
                  @click="triggerFileUpload"
                >
                  <Upload class="mr-2 h-4 w-4" />
                  选择多个视频
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  :disabled="parametersLocked"
                  @click="triggerFolderUpload"
                >
                  <FolderOpen class="mr-2 h-4 w-4" />
                  选择文件夹
                </Button>
              </div>
            </div>
            <div
              v-if="queue.length > 0"
              class="mt-3 space-y-2"
            >
              <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary/5 px-3 py-2 text-sm">
                <span class="font-medium text-foreground">
                  本批次 {{ queue.length }} 集 · {{ formatBytes(totalQueueBytes) }}
                </span>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted-foreground">
                    已提交 {{ submittedQueue.length }} · 失败 {{ failedQueue.length }} · 待处理 {{ pendingQueue.length - failedQueue.length }}
                  </span>
                  <Button
                    v-if="!activeQueue && submittedQueue.length === 0"
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="h-7 text-muted-foreground hover:text-destructive"
                    @click="clearQueue"
                  >
                    清空
                  </Button>
                </div>
              </div>
              <div
                v-if="activeQueue || processedQueueCount > 0"
                class="space-y-1 px-1 py-1"
              >
                <Progress :model-value="batchProgress" />
                <div class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>批次进度</span>
                  <span class="tabular-nums">{{ processedQueueCount }}/{{ queue.length }}（{{ batchProgress }}%）</span>
                </div>
              </div>
              <div class="max-h-96 space-y-2 overflow-y-auto pr-1">
                <div
                  v-for="item in queue"
                  :key="item.id"
                  class="rounded-xl bg-muted/25 px-3 py-3"
                >
                  <div class="flex items-start gap-3">
                    <FileVideo class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center justify-between gap-3">
                        <div class="truncate text-sm font-medium text-foreground">
                          {{ item.fileName }}
                        </div>
                        <div class="flex shrink-0 items-center gap-2">
                          <Badge :variant="item.status === 'failed' ? 'destructive' : item.status === 'submitted' ? 'success' : item.status === 'pending' ? 'secondary' : 'default'">
                            {{
                              item.status === 'pending'
                                ? '待提交'
                                : item.status === 'uploading'
                                  ? '上传中'
                                  : item.status === 'uploaded'
                                    ? '已上传'
                                    : item.status === 'submitting'
                                      ? '提交中'
                                      : item.status === 'submitted'
                                        ? '已提交'
                                        : '失败'
                            }}
                          </Badge>
                          <Button
                            v-if="!activeQueue && item.status !== 'submitted'"
                            type="button"
                            variant="ghost"
                            size="icon"
                            class="h-8 w-8 text-muted-foreground hover:text-destructive"
                            title="移除"
                            @click="removeQueueItem(item.id)"
                          >
                            <Trash2 class="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div class="mt-1 text-xs text-muted-foreground">
                        {{ formatBytes(item.fileSize) }} · {{ item.fileType }}
                      </div>
                      <div
                        v-if="item.status === 'uploading' || item.uploadProgress > 0 && item.status !== 'submitted'"
                        class="mt-3 space-y-1"
                      >
                        <Progress :model-value="item.uploadProgress" />
                        <div class="text-xs text-muted-foreground">
                          正在上传到 TOS：{{ item.uploadProgress }}%
                        </div>
                      </div>
                      <div
                        v-if="item.taskId"
                        class="mt-2 truncate font-mono text-xs text-muted-foreground"
                      >
                        {{ item.taskId }}
                      </div>
                      <div
                        v-if="item.errorMessage"
                        class="mt-2 text-xs leading-5 text-destructive"
                      >
                        {{ item.errorMessage }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div
              v-else
              class="mt-3 rounded-xl bg-muted/15 bg-background/60 p-6 text-center text-sm text-muted-foreground"
            >
              拖拽视频到这里，或选择多个视频/整个剧集文件夹
            </div>
          </div>

          <div
            v-if="selectedKindOption"
            class="rounded-xl bg-muted/25 p-3 text-sm"
          >
            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="font-medium text-foreground">
                  {{ selectedKindOption.label }}适用：{{ selectedKindOption.bestFor }}
                </div>
                <div class="mt-1 text-xs text-muted-foreground">
                  速度 {{ selectedKindOption.speed }} · 成本 {{ selectedKindOption.cost }} · {{ selectedKindOption.limit }}
                  <template v-if="kind === 'standard'">
                    · 场景 {{ selectedSceneLabel }}
                  </template>
                  · 输出 {{ resolutionSummary }}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                @click="showAdvancedOptions = !showAdvancedOptions"
              >
                <Settings class="h-4 w-4" />
                高级参数
                <ChevronDown
                  class="h-4 w-4 transition-transform"
                  :class="showAdvancedOptions ? 'rotate-180' : ''"
                />
              </Button>
            </div>
          </div>

          <div
            v-if="showAdvancedOptions"
            class="grid gap-4 md:grid-cols-3"
          >
            <div
              v-if="kind === 'standard'"
              class="space-y-2"
            >
              <label class="text-sm font-medium text-foreground">业务场景</label>
              <Select v-model="scene" :disabled="parametersLocked">
                <SelectTrigger>
                  <SelectValue placeholder="选择场景" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in sceneOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div
              v-if="supportsResolutionLimit"
              class="space-y-2"
            >
              <label class="text-sm font-medium text-foreground">分辨率方式</label>
              <Select v-model="resolutionMode" :disabled="parametersLocked">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="preset">
                    规格
                  </SelectItem>
                  <SelectItem value="limit">
                    短边像素
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div
              v-if="resolutionMode === 'preset'"
              class="space-y-2"
            >
              <label class="text-sm font-medium text-foreground">输出分辨率</label>
              <Select v-model="resolution" :disabled="parametersLocked">
                <SelectTrigger>
                  <SelectValue placeholder="选择分辨率" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in resolutionOptions"
                    :key="option.value"
                    :value="option.value"
                    :disabled="kind === 'generative' && ['480p', '4k'].includes(option.value)"
                  >
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div
              v-else
              class="space-y-2"
            >
              <label class="text-sm font-medium text-foreground">短边像素</label>
              <Input
                v-model.number="resolutionLimit"
                type="number"
                min="128"
                max="2160"
                :disabled="parametersLocked"
              />
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-foreground">帧率（可选）</label>
              <Input
                v-model.number="fps"
                type="number"
                min="15"
                max="120"
                placeholder="保持原帧率"
                :disabled="parametersLocked"
              />
            </div>
          </div>

          <div
            v-if="kind === 'generative'"
            class="rounded-xl bg-amber-500/10 px-3 py-2 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
          >
            大模型版本输入最高支持 1080p：短边需在 360-1080 像素之间，长边需在 360-1920 像素之间，且仅支持 SDR 视频。
          </div>

          <div
            v-if="errorMessage"
            class="rounded-xl bg-destructive/10 p-3 text-sm leading-6 text-destructive"
          >
            {{ errorMessage }}
          </div>

          <div class="sticky bottom-0 z-10 -mx-6 flex flex-col gap-2 border-t bg-background/95 px-6 py-4 backdrop-blur-sm sm:flex-row sm:items-center">
            <Button
              :disabled="!canSubmit"
              @click="submitTask"
            >
              <Loader2
                v-if="activeQueue"
                class="mr-2 h-4 w-4 animate-spin"
              />
              {{ submitButtonLabel }}
            </Button>
            <div
              v-if="submitHint"
              class="text-xs text-muted-foreground"
            >
              {{ submitHint }}
            </div>
          </div>
        </CardContent>
      </Card>
    </AppPageContent>
  </div>
</template>
