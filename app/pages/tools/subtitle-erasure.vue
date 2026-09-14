<script setup lang="ts">
import { Eraser, FileVideo, FolderOpen, ListChecks, Loader2, Trash2, Upload } from 'lucide-vue-next'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

definePageMeta({ layout: 'default' })

type QueueStatus = 'pending' | 'uploading' | 'uploaded' | 'submitting' | 'submitted' | 'failed'

interface UploadResponse {
  success: boolean
  videoUrl: string
  sourceObjectKey?: string
  reused?: boolean
  message?: string
}

interface SubmitResponse {
  success: boolean
  taskId: string
}

interface QueueItem {
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
    data?: { message?: string }
    message?: string
    statusMessage?: string
  }
}

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024
const route = useRoute()
const router = useRouter()
const { toast } = useToast()
const { confirm } = useConfirm()
const queue = ref<QueueItem[]>([])
const submitting = ref(false)
const uploadingSource = ref(false)
const errorMessage = ref('')
const draggingFiles = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const folderInputRef = ref<HTMLInputElement | null>(null)
const batchId = ref('')

const embeddedInMediaWorkbench = computed(() => route.path === '/tools/enhance')
const activeQueue = computed(() => submitting.value || uploadingSource.value)
const pendingQueue = computed(() => queue.value.filter(item => item.status !== 'submitted'))
const submittedQueue = computed(() => queue.value.filter(item => item.status === 'submitted'))
const failedQueue = computed(() => queue.value.filter(item => item.status === 'failed'))
const processedQueueCount = computed(() => submittedQueue.value.length + failedQueue.value.length)
const totalQueueBytes = computed(() => queue.value.reduce((total, item) => total + item.fileSize, 0))
const canSubmit = computed(() => queue.value.length > 0 && pendingQueue.value.length > 0 && !activeQueue.value)
const batchProgress = computed(() => {
  if (!queue.value.length) return 0
  const activeItem = queue.value.find(item => item.status === 'uploading' || item.status === 'submitting')
  const activeProgress = activeItem?.status === 'uploading'
    ? activeItem.uploadProgress / 100
    : activeItem ? 1 : 0
  return Math.round(((processedQueueCount.value + activeProgress) / queue.value.length) * 100)
})
const submitButtonLabel = computed(() => {
  if (activeQueue.value) return `批量处理中 ${processedQueueCount.value}/${queue.value.length}`
  if (failedQueue.value.length && pendingQueue.value.length === failedQueue.value.length) {
    return `重试 ${failedQueue.value.length} 个失败任务`
  }
  return `提交 ${pendingQueue.value.length} 个字幕擦除任务`
})
const submitHint = computed(() => {
  if (uploadingSource.value) return '正在上传源视频，请稍候。'
  if (submitting.value) return '正在创建云端任务，请稍候。'
  if (!queue.value.length) return '请选择一个或多个本地视频。'
  return ''
})

const fileNameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

function createQueueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)
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

function resolveFetchErrorMessage(error: unknown, fallback: string) {
  const fetchError = error as FetchErrorWithData
  return fetchError.data?.data?.message
    || fetchError.data?.message
    || fetchError.data?.statusMessage
    || (error instanceof Error ? error.message : fallback)
}

function addFilesToQueue(files: File[]) {
  const videoFiles = files.filter(isVideoFile)
  const validFiles = videoFiles.filter(file => file.size <= MAX_FILE_SIZE)
  if (!validFiles.length) {
    errorMessage.value = videoFiles.length ? '视频文件不能超过 2GB。' : '请选择视频文件。'
    return
  }
  const existing = new Set(queue.value.map(item => `${item.fileName}:${item.fileSize}:${item.file.lastModified}`))
  const uniqueFiles = validFiles.filter((file) => {
    const signature = `${file.name}:${file.size}:${file.lastModified}`
    if (existing.has(signature)) return false
    existing.add(signature)
    return true
  })
  if (!uniqueFiles.length) {
    toast.warning('所选视频已在当前批次中')
    return
  }
  errorMessage.value = ''
  queue.value.push(...uniqueFiles.map(file => ({
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

  const ignoredCount = files.length - videoFiles.length
  const oversizeCount = videoFiles.length - validFiles.length
  const duplicateCount = validFiles.length - uniqueFiles.length
  if (ignoredCount) toast.warning(`已忽略 ${ignoredCount} 个非视频文件`)
  if (oversizeCount) toast.warning(`已忽略 ${oversizeCount} 个超过 2GB 的视频`)
  if (duplicateCount) toast.warning(`已忽略 ${duplicateCount} 个重复视频`)
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  addFilesToQueue(Array.from(input.files || []))
  input.value = ''
}

function handleDragEnter(event: DragEvent) {
  if (activeQueue.value || !event.dataTransfer?.types.includes('Files')) return
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
  if (activeQueue.value) return
  addFilesToQueue(Array.from(event.dataTransfer?.files || []))
}

function removeQueueItem(id: string) {
  if (activeQueue.value) return
  queue.value = queue.value.filter(item => item.id !== id)
}

function clearQueue() {
  if (activeQueue.value) return
  queue.value = []
  batchId.value = ''
  errorMessage.value = ''
}

function uploadSourceVideo(item: QueueItem) {
  return new Promise<UploadResponse>((resolve, reject) => {
    const request = new XMLHttpRequest()
    const form = new FormData()
    form.append('video', item.file, item.fileName)
    request.open('POST', '/api/tools/subtitle-erasure/upload-source')
    request.responseType = 'json'
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      item.uploadProgress = Math.min(99, Math.round((event.loaded / event.total) * 100))
    }
    request.onload = () => {
      const response = request.response as UploadResponse | { message?: string } | null
      if (request.status >= 200 && request.status < 300 && response && 'videoUrl' in response) {
        item.uploadProgress = 100
        resolve(response)
        return
      }
      reject(new Error(response && 'message' in response && response.message ? response.message : '上传源视频到 TOS 失败'))
    }
    request.onerror = () => reject(new Error('上传源视频到 TOS 失败，请检查网络或 TOS 配置'))
    request.send(form)
  })
}

async function submitQueueItem(item: QueueItem, currentBatchId: string) {
  item.errorMessage = ''
  if (!item.sourceVideoUrl) {
    item.status = 'uploading'
    uploadingSource.value = true
    item.uploadProgress = 0
    const upload = await uploadSourceVideo(item)
    item.sourceVideoUrl = upload.videoUrl
    item.sourceObjectKey = upload.sourceObjectKey || ''
    item.reused = upload.reused === true
    item.status = 'uploaded'
  }
  item.status = 'submitting'
  const response = await $fetch<SubmitResponse>('/api/tools/subtitle-erasure', {
    method: 'POST',
    body: {
      videoUrl: item.sourceVideoUrl,
      sourceFileName: item.fileName,
      sourceObjectKey: item.sourceObjectKey || undefined,
      batchId: currentBatchId
    }
  })
  item.taskId = response.taskId
  item.status = 'submitted'
}

async function submitTasks() {
  if (!canSubmit.value) return
  const confirmed = await confirm({
    title: `提交 ${pendingQueue.value.length} 个字幕擦除任务？`,
    description: '视频将依次上传到 TOS，并为每个视频创建独立的精细化字幕擦除任务。',
    confirmText: '确认批量提交',
    cancelText: '返回检查'
  })
  if (!confirmed) return

  for (const item of queue.value) {
    if (item.status !== 'failed') continue
    item.status = item.sourceVideoUrl ? 'uploaded' : 'pending'
    item.errorMessage = ''
  }
  submitting.value = true
  if (!batchId.value) batchId.value = `ser_batch_${crypto.randomUUID()}`
  const currentBatchId = batchId.value
  errorMessage.value = ''
  let successCount = 0
  let failedCount = 0
  try {
    for (const item of queue.value) {
      if (item.status === 'submitted') continue
      try {
        await submitQueueItem(item, currentBatchId)
        successCount += 1
      } catch (error) {
        item.status = 'failed'
        item.errorMessage = resolveFetchErrorMessage(error, '提交字幕擦除任务失败')
        failedCount += 1
      } finally {
        uploadingSource.value = false
      }
    }
    if (successCount) toast.success(`已提交 ${successCount} 个字幕擦除任务`)
    if (failedCount) {
      errorMessage.value = `${failedCount} 个任务提交失败，请查看队列中的错误后重试。`
      return
    }
    if (successCount) {
      await router.push({
        path: '/tools/enhance',
        query: { type: 'subtitle-erasure', view: 'tasks' }
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
    description: `当前还有 ${pendingQueue.value.length} 个视频尚未提交，离开页面后需要重新选择。`,
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
      v-if="!embeddedInMediaWorkbench"
      title="字幕擦除"
      description="批量上传本地视频，并提交精细化字幕擦除任务。"
    >
      <template #actions>
        <Button variant="outline" size="sm" as-child>
          <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'subtitle-erasure', view: 'tasks' } }">
            <ListChecks class="mr-2 h-4 w-4" />
            任务
          </NuxtLink>
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent scroll inner-class="space-y-6">
      <Card>
        <CardContent class="space-y-5 pt-6">
          <div class="flex items-start gap-3 rounded-xl bg-muted/25 p-4">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Eraser class="h-5 w-5" />
            </span>
            <div>
              <h2 class="text-sm font-semibold">精细化字幕擦除</h2>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                移除画面内已经合成的硬字幕，并修复被遮挡区域。每个视频会创建一个独立任务。
              </p>
            </div>
          </div>

          <div
            class="rounded-xl bg-muted/30 p-4 transition-colors duration-150"
            :class="draggingFiles ? 'ring-2 ring-primary bg-primary/5' : ''"
            @dragenter.prevent="handleDragEnter"
            @dragover.prevent
            @dragleave.prevent="handleDragLeave"
            @drop.prevent="handleDrop"
          >
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div class="text-sm font-medium">本地视频</div>
                <div class="mt-1 text-xs text-muted-foreground">支持多选、文件夹导入或直接拖拽，单个视频最大 2GB。</div>
              </div>
              <input
                ref="fileInputRef"
                type="file"
                multiple
                accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
                class="hidden"
                @change="handleFileChange"
              >
              <input
                ref="folderInputRef"
                type="file"
                multiple
                webkitdirectory
                accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
                class="hidden"
                @change="handleFileChange"
              >
              <div class="flex flex-wrap gap-2">
                <Button variant="outline" :disabled="activeQueue" @click="fileInputRef?.click()">
                  <Upload class="mr-2 h-4 w-4" />
                  选择多个视频
                </Button>
                <Button variant="outline" :disabled="activeQueue" @click="folderInputRef?.click()">
                  <FolderOpen class="mr-2 h-4 w-4" />
                  选择文件夹
                </Button>
              </div>
            </div>

            <div v-if="queue.length" class="mt-3 space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary/5 px-3 py-2 text-sm">
                <span class="font-medium">本批次 {{ queue.length }} 个视频 · {{ formatBytes(totalQueueBytes) }}</span>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted-foreground">
                    已提交 {{ submittedQueue.length }} · 失败 {{ failedQueue.length }} · 待处理 {{ pendingQueue.length - failedQueue.length }}
                  </span>
                  <Button
                    v-if="!activeQueue && !submittedQueue.length"
                    variant="ghost"
                    size="sm"
                    class="h-7 text-muted-foreground hover:text-destructive"
                    @click="clearQueue"
                  >
                    清空
                  </Button>
                </div>
              </div>

              <div v-if="activeQueue || processedQueueCount" class="space-y-1 px-1 py-1">
                <Progress :model-value="batchProgress" />
                <div class="flex justify-between text-xs text-muted-foreground">
                  <span>批次进度</span>
                  <span class="tabular-nums">{{ processedQueueCount }}/{{ queue.length }}（{{ batchProgress }}%）</span>
                </div>
              </div>

              <div class="max-h-96 space-y-2 overflow-y-auto pr-1">
                <div v-for="item in queue" :key="item.id" class="rounded-xl bg-muted/25 px-3 py-3">
                  <div class="flex items-start gap-3">
                    <FileVideo class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center justify-between gap-3">
                        <div class="truncate text-sm font-medium">{{ item.fileName }}</div>
                        <div class="flex shrink-0 items-center gap-2">
                          <Badge :variant="item.status === 'failed' ? 'destructive' : item.status === 'submitted' ? 'success' : item.status === 'pending' ? 'secondary' : 'default'">
                            {{
                              item.status === 'pending' ? '待提交'
                                : item.status === 'uploading' ? '上传中'
                                  : item.status === 'uploaded' ? '已上传'
                                    : item.status === 'submitting' ? '提交中'
                                      : item.status === 'submitted' ? '已提交' : '失败'
                            }}
                          </Badge>
                          <Button
                            v-if="!activeQueue && item.status !== 'submitted'"
                            variant="ghost"
                            size="icon"
                            class="h-8 w-8 text-muted-foreground hover:text-destructive active:scale-[0.96] transition-transform"
                            title="移除"
                            @click="removeQueueItem(item.id)"
                          >
                            <Trash2 class="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div class="mt-1 text-xs text-muted-foreground">{{ formatBytes(item.fileSize) }} · {{ item.fileType }}</div>
                      <div v-if="item.status === 'uploading' || item.uploadProgress > 0 && item.status !== 'submitted'" class="mt-3 space-y-1">
                        <Progress :model-value="item.uploadProgress" />
                        <div class="text-xs text-muted-foreground">正在上传到 TOS：{{ item.uploadProgress }}%</div>
                      </div>
                      <div v-if="item.taskId" class="mt-2 truncate font-mono text-xs text-muted-foreground">{{ item.taskId }}</div>
                      <div v-if="item.errorMessage" class="mt-2 text-xs leading-5 text-destructive">{{ item.errorMessage }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="mt-3 rounded-xl bg-background/60 p-8 text-center text-sm text-muted-foreground">
              拖拽视频到这里，或选择多个视频/整个剧集文件夹
            </div>
          </div>

          <div v-if="errorMessage" class="rounded-xl bg-destructive/10 p-3 text-sm leading-6 text-destructive">
            {{ errorMessage }}
          </div>

          <div class="sticky bottom-0 z-10 -mx-6 flex flex-col gap-2 border-t bg-background/95 px-6 py-4 backdrop-blur-sm sm:flex-row sm:items-center">
            <Button
              :disabled="!canSubmit"
              class="active:scale-[0.96] transition-transform"
              @click="submitTasks"
            >
              <Loader2 v-if="activeQueue" class="mr-2 h-4 w-4 animate-spin" />
              <Eraser v-else class="mr-2 h-4 w-4" />
              {{ submitButtonLabel }}
            </Button>
            <div v-if="submitHint" class="text-xs text-muted-foreground">{{ submitHint }}</div>
          </div>
        </CardContent>
      </Card>
    </AppPageContent>
  </div>
</template>
