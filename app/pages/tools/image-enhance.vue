<script setup lang="ts">
import { FileImage, ListChecks, Loader2, Trash2, Upload, WandSparkles } from 'lucide-vue-next'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

definePageMeta({
  layout: 'default'
})

type EnhanceKind = 'standard' | 'portrait' | 'old_photo' | 'upscale'

interface EnhanceSubmitResponse {
  success: boolean
  taskId: string
}

interface EnhanceUploadResponse {
  success: boolean
  imageUrl: string
  sourceObjectKey?: string
  reused?: boolean
}

type QueueStatus = 'pending' | 'uploading' | 'uploaded' | 'submitting' | 'submitted' | 'failed'

interface ImageEnhanceQueueItem {
  id: string
  file: File
  fileName: string
  fileSize: number
  fileType: string
  previewUrl: string
  sourceImageUrl: string
  sourceObjectKey: string
  uploadProgress: number
  status: QueueStatus
  taskId: string
  errorMessage: string
  reused: boolean
}

const router = useRouter()
const route = useRoute()
const { toast } = useToast()

const kind = ref<EnhanceKind>('standard')
const queue = ref<ImageEnhanceQueueItem[]>([])
const scale = ref('2')
const outputFormat = ref('original')
const submitting = ref(false)
const uploadingSource = ref(false)
const errorMessage = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const draggingFiles = ref(false)

const embeddedInUnifiedEnhance = computed(() => route.path === '/tools/enhance')

const kindOptions: Array<{
  value: EnhanceKind
  label: string
  description: string
  bestFor: string
}> = [
  {
    value: 'standard',
    label: '标准增强',
    description: '提升清晰度、细节和整体观感，适合通用素材。',
    bestFor: '商品图、场景图、普通参考图'
  },
  {
    value: 'portrait',
    label: '人像增强',
    description: '偏向人脸和皮肤细节修复，适合角色头像和人物照。',
    bestFor: '角色图、人像参考'
  },
  {
    value: 'old_photo',
    label: '老照片修复',
    description: '针对低清、褪色或老照片类素材做修复。',
    bestFor: '老照片、低清扫描图'
  },
  {
    value: 'upscale',
    label: '超分放大',
    description: '放大图片并补充细节，适合小尺寸素材。',
    bestFor: '低分辨率图片'
  }
]

const formatOptions = [
  { value: 'original', label: '保持原格式' },
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
  { value: 'webp', label: 'WebP' }
]

const activeQueue = computed(() => uploadingSource.value || submitting.value)
const pendingQueue = computed(() => queue.value.filter(item => item.status !== 'submitted'))
const canSubmit = computed(() => queue.value.length > 0 && pendingQueue.value.length > 0 && !activeQueue.value)
const activeKindOption = computed(() => kindOptions.find(option => option.value === kind.value))
const submitHint = computed(() => {
  if (submitting.value) return '正在提交任务，请稍候。'
  if (uploadingSource.value) return '源图片正在上传，请稍候。'
  if (queue.value.length === 0) return '请选择一张或多张本地图片。'
  return ''
})

watch(kind, (value) => {
  if (value !== 'upscale') {
    scale.value = '2'
  }
})

onUnmounted(() => {
  for (const item of queue.value) {
    URL.revokeObjectURL(item.previewUrl)
  }
})

function triggerFileUpload() {
  fileInputRef.value?.click()
}

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(file.name)
}

function addFilesToQueue(files: File[]) {
  const imageFiles = files.filter(isImageFile)
  if (imageFiles.length === 0) {
    errorMessage.value = '请拖入图片文件。'
    return
  }

  errorMessage.value = ''
  queue.value.push(...imageFiles.map(file => ({
    id: createQueueId(),
    file,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type || '图片文件',
    previewUrl: URL.createObjectURL(file),
    sourceImageUrl: '',
    sourceObjectKey: '',
    uploadProgress: 0,
    status: 'pending' as QueueStatus,
    taskId: '',
    errorMessage: '',
    reused: false
  })))

  if (imageFiles.length < files.length) {
    toast.warning(`已忽略 ${files.length - imageFiles.length} 个非图片文件`)
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

function createQueueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function buildRequestBody(item: ImageEnhanceQueueItem) {
  const body: Record<string, unknown> = {
    kind: kind.value,
    imageUrl: item.sourceImageUrl.trim(),
    sourceFileName: item.fileName || '本地图片',
    sourceObjectKey: item.sourceObjectKey || undefined
  }
  if (kind.value === 'upscale') {
    body.scale = Number(scale.value)
  }
  if (outputFormat.value !== 'original') {
    body.format = outputFormat.value
  }
  return body
}

function uploadSourceImage(formData: FormData, onProgress: (progress: number) => void): Promise<EnhanceUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/tools/image-enhance/upload-source')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onload = () => {
      const response = xhr.response as EnhanceUploadResponse | { message?: string } | null
      if (xhr.status >= 200 && xhr.status < 300 && response && 'imageUrl' in response) {
        onProgress(100)
        resolve(response)
        return
      }
      reject(new Error(response && 'message' in response && response.message ? response.message : '上传源图片到 TOS 失败'))
    }
    xhr.onerror = () => reject(new Error('上传源图片到 TOS 失败，请检查网络或 TOS 配置'))
    xhr.send(formData)
  })
}

async function handleSourceFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  const files = Array.from(input?.files || [])
  if (files.length > 0) addFilesToQueue(files)
  if (input) input.value = ''
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
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length > 0) addFilesToQueue(files)
}

function removeQueueItem(id: string) {
  if (activeQueue.value) return
  const item = queue.value.find(value => value.id === id)
  if (item) URL.revokeObjectURL(item.previewUrl)
  queue.value = queue.value.filter(value => value.id !== id)
}

async function submitQueueItem(item: ImageEnhanceQueueItem) {
  item.errorMessage = ''
  if (!item.sourceImageUrl) {
    item.status = 'uploading'
    uploadingSource.value = true
    item.uploadProgress = 0
    const formData = new FormData()
    formData.append('image', item.file, item.fileName)
    const uploadResponse = await uploadSourceImage(formData, (progress) => {
      item.uploadProgress = progress
    })
    item.sourceImageUrl = uploadResponse.imageUrl
    item.sourceObjectKey = uploadResponse.sourceObjectKey || ''
    item.reused = uploadResponse.reused === true
    item.status = 'uploaded'
  }

  item.status = 'submitting'
  const response = await $fetch<EnhanceSubmitResponse>('/api/tools/image-enhance', {
    method: 'POST',
    body: buildRequestBody(item)
  })
  item.taskId = response.taskId
  item.status = 'submitted'
}

async function submitTask() {
  errorMessage.value = ''
  submitting.value = true
  let successCount = 0
  let failedCount = 0
  try {
    for (const item of queue.value) {
      if (item.status === 'submitted') continue
      try {
        await submitQueueItem(item)
        successCount += 1
      } catch (error) {
        item.status = 'failed'
        item.errorMessage = error instanceof Error ? error.message : '提交图片增强任务失败'
        failedCount += 1
      } finally {
        uploadingSource.value = false
      }
    }

    if (successCount > 0) {
      toast.success(`已提交 ${successCount} 个图片增强任务`)
    }
    if (failedCount > 0) {
      errorMessage.value = `${failedCount} 个任务提交失败，请检查队列中的错误信息后重试。`
      return
    }
    if (successCount > 0) {
      await router.push({
        path: '/tools/enhance',
        query: { type: 'image', view: 'tasks' }
      })
    }
  } finally {
    uploadingSource.value = false
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col bg-background">
    <AppPageHeader
      v-if="!embeddedInUnifiedEnhance"
      title="图片增强"
      description="选择本地图片上传到 TOS 后，提交到火山引擎 AI MediaKit 进行云端增强。"
    >
      <template #actions>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" as-child>
            <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'image', view: 'tasks' } }">
              <ListChecks class="mr-2 h-4 w-4" />
              任务
            </NuxtLink>
          </Button>
          <Button variant="outline" size="sm" as-child>
            <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'image', view: 'create', mode: 'local' } }">
              本地图片
            </NuxtLink>
          </Button>
        </div>
      </template>
    </AppPageHeader>

    <AppPageContent scroll inner-class="space-y-6">
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card
          class="transition-colors"
          :class="draggingFiles ? 'border-primary bg-primary/5' : ''"
          @dragenter.prevent="handleDragEnter"
          @dragover.prevent
          @dragleave.prevent="handleDragLeave"
          @drop.prevent="handleDrop"
        >
          <CardHeader class="border-b">
            <CardTitle class="text-lg">
              源图片
            </CardTitle>
            <CardDescription>
              支持点击选择或拖拽导入多张图片，单张上限 50MB。
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-5 pt-6">
            <input
              ref="fileInputRef"
              type="file"
              multiple
              accept="image/*,.png,.jpg,.jpeg,.webp,.bmp"
              class="hidden"
              @change="handleSourceFileChange"
            >
            <div
              v-if="queue.length === 0"
              class="flex min-h-[280px] items-center justify-center rounded-xl bg-muted/15 bg-muted/30 p-4"
            >
              <div class="text-center">
                <FileImage class="mx-auto h-10 w-10 text-muted-foreground" />
                <p class="mt-3 text-sm text-muted-foreground">
                  拖拽图片到这里，或点击“选择图片”
                </p>
              </div>
            </div>
            <div
              v-else
              class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            >
              <div
                v-for="item in queue"
                :key="item.id"
                class="overflow-hidden rounded-xl bg-muted/25"
              >
                <div class="flex aspect-video items-center justify-center bg-muted/30">
                  <img
                    :src="item.previewUrl"
                    alt="源图片预览"
                    class="h-full w-full object-contain"
                  >
                </div>
                <div class="space-y-2 p-3">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium text-foreground">
                        {{ item.fileName }}
                      </div>
                      <div class="mt-1 text-xs text-muted-foreground">
                        {{ item.fileType }} · {{ formatBytes(item.fileSize) }}
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
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
                  <div
                    v-if="item.status === 'uploading' || item.uploadProgress > 0 && item.status !== 'submitted'"
                    class="space-y-1"
                  >
                    <Progress :model-value="item.uploadProgress" />
                    <div class="text-xs text-muted-foreground">
                      上传进度 {{ item.uploadProgress }}%
                    </div>
                  </div>
                  <div
                    v-if="item.taskId"
                    class="truncate font-mono text-xs text-muted-foreground"
                  >
                    {{ item.taskId }}
                  </div>
                  <div
                    v-if="item.errorMessage"
                    class="text-xs leading-5 text-destructive"
                  >
                    {{ item.errorMessage }}
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0 text-sm">
                <div class="text-muted-foreground">
                  {{ queue.length > 0 ? `已选择 ${queue.length} 张图片` : '尚未选择图片' }}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                :disabled="activeQueue"
                @click="triggerFileUpload"
              >
                <Upload class="mr-2 h-4 w-4" />
                选择图片
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="border-b">
            <CardTitle class="text-lg">
              增强设置
            </CardTitle>
            <CardDescription>
              云端任务完成后可在任务页保存结果。
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-5 pt-6">
            <div class="space-y-2">
              <label class="text-sm font-medium text-foreground">增强类型</label>
              <div class="space-y-2">
                <button
                  v-for="option in kindOptions"
                  :key="option.value"
                  type="button"
                  class="w-full rounded-xl bg-muted/20 p-3 text-left transition-colors hover:bg-muted/35"
                  :class="kind === option.value ? 'border-primary bg-primary/5' : 'border-border'"
                  @click="kind = option.value"
                >
                  <div class="text-sm font-medium text-foreground">
                    {{ option.label }}
                  </div>
                  <div class="mt-1 text-xs leading-5 text-muted-foreground">
                    {{ option.description }}
                  </div>
                </button>
              </div>
            </div>
            <div v-if="kind === 'upscale'" class="space-y-2">
              <label class="text-sm font-medium text-foreground">放大倍率</label>
              <Select v-model="scale">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2x</SelectItem>
                  <SelectItem value="4">4x</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium text-foreground">输出格式</label>
              <Select v-model="outputFormat">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in formatOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="rounded-md bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
              当前适合：{{ activeKindOption?.bestFor }}
            </div>
            <Alert v-if="errorMessage" variant="destructive">
              <AlertDescription>{{ errorMessage }}</AlertDescription>
            </Alert>
            <Button class="w-full" :disabled="!canSubmit" @click="submitTask">
              <Loader2 v-if="activeQueue" class="mr-2 h-4 w-4 animate-spin" />
              <WandSparkles v-else class="mr-2 h-4 w-4" />
              提交 {{ pendingQueue.length }} 个云端增强
            </Button>
            <p v-if="submitHint" class="text-xs text-muted-foreground">
              {{ submitHint }}
            </p>
          </CardContent>
        </Card>
      </div>
    </AppPageContent>
  </div>
</template>
