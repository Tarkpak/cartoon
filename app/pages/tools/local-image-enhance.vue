<script setup lang="ts">
import { FileImage, Loader2, MonitorCog, Trash2, Upload } from 'lucide-vue-next'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

definePageMeta({
  layout: 'default'
})

type LocalEnhancePreset = 'light' | 'clarity' | 'denoise' | 'sharpen' | 'upscale_2x' | 'upscale_4x' | 'webp' | 'jpeg'

interface LocalEnhanceResponse {
  success: boolean
  taskId: string
  preset: LocalEnhancePreset
  presetLabel: string
  sourceFileName: string
  imageUrl: string
  elapsedMs: number
}

type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed'

interface LocalImageQueueItem {
  id: string
  file: File
  fileName: string
  fileSize: number
  fileType: string
  previewUrl: string
  preset: LocalEnhancePreset
  presetLabel: string
  progress: number
  status: QueueStatus
  result: LocalEnhanceResponse | null
  errorMessage: string
}

const { toast } = useToast()
const route = useRoute()

const preset = ref<LocalEnhancePreset>('light')
const queue = ref<LocalImageQueueItem[]>([])
const processing = ref(false)
const errorMessage = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const draggingFiles = ref(false)

const embeddedInUnifiedLocalEnhance = computed(() => ['/tools/enhance', '/tools/local-enhance'].includes(route.path))

const presetOptions: Array<{
  value: LocalEnhancePreset
  label: string
  description: string
  output: string
}> = [
  { value: 'light', label: '轻度增强', description: '轻微对比度、饱和度和锐化调整。', output: '保持近似原格式' },
  { value: 'clarity', label: '清晰增强', description: '更强对比度和锐化，适合普通素材。', output: '保持近似原格式' },
  { value: 'denoise', label: '降噪', description: '降低压缩噪点和轻微颗粒感。', output: '保持近似原格式' },
  { value: 'sharpen', label: '锐化', description: '增强边缘清晰度和局部细节。', output: '保持近似原格式' },
  { value: 'upscale_2x', label: '2x 放大', description: '使用 Lanczos 放大到 2 倍并锐化。', output: 'PNG/JPG/WebP' },
  { value: 'upscale_4x', label: '4x 放大', description: '使用 Lanczos 放大到 4 倍并锐化。', output: 'PNG/JPG/WebP' },
  { value: 'webp', label: '转 WebP', description: '转换为 WebP 格式，适合网页素材。', output: 'WebP' },
  { value: 'jpeg', label: '转 JPEG', description: '转换为高质量 JPEG。', output: 'JPG' }
]

const pendingQueue = computed(() => queue.value.filter(item => item.status !== 'completed'))
const canSubmit = computed(() => queue.value.length > 0 && pendingQueue.value.length > 0 && !processing.value)
const activePreset = computed(() => presetOptions.find(option => option.value === preset.value))

onUnmounted(() => {
  for (const item of queue.value) {
    URL.revokeObjectURL(item.previewUrl)
  }
})

function triggerFileUpload() {
  fileInputRef.value?.click()
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

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '不到 1 秒'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes} 分 ${rest} 秒`
}

function createQueueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
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
    preset: preset.value,
    presetLabel: activePreset.value?.label || '轻度增强',
    progress: 0,
    status: 'pending' as QueueStatus,
    result: null,
    errorMessage: ''
  })))

  if (imageFiles.length < files.length) {
    toast.warning(`已忽略 ${files.length - imageFiles.length} 个非图片文件`)
  }
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  const files = Array.from(input?.files || [])
  if (files.length > 0) addFilesToQueue(files)
  if (input) input.value = ''
}

function removeQueueItem(id: string) {
  if (processing.value) return
  const item = queue.value.find(value => value.id === id)
  if (item) URL.revokeObjectURL(item.previewUrl)
  queue.value = queue.value.filter(value => value.id !== id)
}

function handleDragEnter(event: DragEvent) {
  if (processing.value || !event.dataTransfer?.types.includes('Files')) return
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
  if (processing.value) return
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length > 0) addFilesToQueue(files)
}

function runLocalEnhance(item: LocalImageQueueItem): Promise<LocalEnhanceResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('preset', item.preset)
    formData.append('image', item.file, item.fileName)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/tools/local-image-enhance')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      item.progress = Math.min(99, Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      const response = xhr.response as LocalEnhanceResponse | { message?: string } | null
      if (xhr.status >= 200 && xhr.status < 300 && response && 'imageUrl' in response) {
        item.progress = 100
        resolve(response)
        return
      }
      reject(new Error(response && 'message' in response && response.message ? response.message : '本地图片处理失败'))
    }
    xhr.onerror = () => reject(new Error('本地图片处理失败，请确认 FFmpeg 可用'))
    xhr.send(formData)
  })
}

async function submitLocalEnhance() {
  processing.value = true
  errorMessage.value = ''
  let successCount = 0
  let failedCount = 0
  try {
    for (const item of queue.value) {
      if (item.status === 'completed') continue
      item.status = 'processing'
      item.errorMessage = ''
      item.result = null
      item.progress = 0
      try {
        const response = await runLocalEnhance(item)
        item.result = response
        item.status = 'completed'
        successCount += 1
      } catch (error) {
        item.status = 'failed'
        item.errorMessage = error instanceof Error ? error.message : '本地图片处理失败'
        failedCount += 1
      }
    }
    if (successCount > 0) {
      toast.success(`本地图片处理完成 ${successCount} 张`)
    }
    if (failedCount > 0) {
      errorMessage.value = `${failedCount} 张图片处理失败，请检查队列中的错误信息后重试。`
    }
  } finally {
    processing.value = false
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col bg-background">
    <AppPageHeader
      v-if="!embeddedInUnifiedLocalEnhance"
      title="本地图片处理"
      description="使用本机 FFmpeg 对图片做基础增强、放大或格式转换，不上传云端。"
    >
      <template #actions>
        <Button variant="outline" size="sm" as-child>
          <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'image', view: 'create', mode: 'cloud' } }">
            云端图片增强
          </NuxtLink>
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent scroll inner-class="space-y-6">
      <Card>
        <CardHeader class="border-b">
          <CardTitle class="text-lg">
            处理预设
          </CardTitle>
          <CardDescription>
            本地处理使用传统滤镜，适合快速预览和轻量修图。
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-6 pt-6">
          <div class="grid gap-3 md:grid-cols-4">
            <button
              v-for="option in presetOptions"
              :key="option.value"
              type="button"
              class="rounded-xl bg-muted/20 p-3 text-left transition-colors hover:bg-muted/35"
              :class="preset === option.value ? 'border-primary bg-primary/5' : 'border-border'"
              @click="preset = option.value"
            >
              <div class="text-sm font-medium text-foreground">
                {{ option.label }}
              </div>
              <div class="mt-1 text-xs leading-5 text-muted-foreground">
                {{ option.description }}
              </div>
              <div class="mt-3 text-xs text-muted-foreground">
                输出：<span class="text-foreground">{{ option.output }}</span>
              </div>
            </button>
          </div>

          <section class="space-y-3 border-t pt-6">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="text-base font-semibold text-foreground">
                  源图片
                </h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  支持 PNG、JPG、WebP、BMP，单张上限 50MB。
                </p>
              </div>
              <input
                ref="fileInputRef"
                type="file"
                multiple
                accept="image/*,.png,.jpg,.jpeg,.webp,.bmp"
                class="hidden"
                @change="handleFileChange"
              >
              <Button
                type="button"
                variant="outline"
                :disabled="processing"
                @click="triggerFileUpload"
              >
                <Upload class="mr-2 h-4 w-4" />
                选择图片
              </Button>
            </div>

            <div
              class="rounded-xl bg-muted/15 bg-muted/30 p-4 transition-colors"
              :class="draggingFiles ? 'border-primary bg-primary/5' : 'border-border'"
              @dragenter.prevent="handleDragEnter"
              @dragover.prevent
              @dragleave.prevent="handleDragLeave"
              @drop.prevent="handleDrop"
            >
              <div
                v-if="queue.length === 0"
                class="py-8 text-center text-sm text-muted-foreground"
              >
                拖拽图片到这里，或点击“选择图片”
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
                          {{ item.fileType }} · {{ formatBytes(item.fileSize) }} · {{ item.presetLabel }}
                        </div>
                      </div>
                      <div class="flex shrink-0 items-center gap-1">
                        <Badge :variant="item.status === 'failed' ? 'destructive' : item.status === 'completed' ? 'success' : item.status === 'processing' ? 'default' : 'secondary'">
                          {{
                            item.status === 'pending'
                              ? '待处理'
                              : item.status === 'processing'
                                ? '处理中'
                                : item.status === 'completed'
                                  ? '已完成'
                                  : '失败'
                          }}
                        </Badge>
                        <Button
                          v-if="!processing && item.status !== 'completed'"
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
                      v-if="item.status === 'processing' || item.progress > 0 && item.status !== 'completed'"
                      class="space-y-1"
                    >
                      <Progress :model-value="item.progress" />
                      <div class="text-xs text-muted-foreground">
                        上传进度 {{ item.progress }}%
                      </div>
                    </div>
                    <div
                      v-if="item.result"
                      class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground"
                    >
                      <span>{{ item.result.presetLabel }} · {{ formatDuration(item.result.elapsedMs) }}</span>
                      <Button variant="outline" size="sm" as-child>
                        <a :href="item.result.imageUrl" target="_blank" rel="noreferrer">打开图片</a>
                      </Button>
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
            </div>

            <Alert v-if="errorMessage" variant="destructive">
              <AlertDescription>{{ errorMessage }}</AlertDescription>
            </Alert>
            <div class="flex justify-end">
              <Button :disabled="!canSubmit" @click="submitLocalEnhance">
                <Loader2 v-if="processing" class="mr-2 h-4 w-4 animate-spin" />
                <MonitorCog v-else class="mr-2 h-4 w-4" />
                开始处理 {{ pendingQueue.length }} 张图片
              </Button>
            </div>
          </section>

          <section
            v-if="queue.some(item => item.result)"
            class="space-y-3 border-t pt-6"
          >
            <h2 class="text-base font-semibold text-foreground">
              处理结果
            </h2>
            <div class="grid gap-4 lg:grid-cols-2">
              <ToolsImageCompareViewer
                v-for="item in queue.filter(value => value.result)"
                :key="item.id"
                :before-url="item.previewUrl"
                :after-url="item.result?.imageUrl || ''"
                :before-label="item.fileName"
                after-label="处理结果"
                empty-label="暂无结果"
              />
            </div>
          </section>
        </CardContent>
      </Card>
    </AppPageContent>
  </div>
</template>
