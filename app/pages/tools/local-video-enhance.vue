<script setup lang="ts">
import { ExternalLink, FileVideo, Loader2, MonitorCog, Sparkles, Trash2, Upload } from 'lucide-vue-next'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

definePageMeta({
  layout: 'default'
})

type LocalEnhancePreset = 'light' | 'clarity' | 'upscale_1080p' | 'high_fps'

interface LocalEnhanceResponse {
  success: boolean
  taskId: string
  preset: LocalEnhancePreset
  presetLabel: string
  sourceFileName: string
  videoUrl: string
  elapsedMs: number
}

type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed'

interface LocalVideoQueueItem {
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
const queue = ref<LocalVideoQueueItem[]>([])
const processing = ref(false)
const errorMessage = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const draggingFiles = ref(false)

const embeddedInUnifiedLocalEnhance = computed(() => ['/tools/enhance', '/tools/local-enhance'].includes(route.path))

const presetOptions: Array<{
  value: LocalEnhancePreset
  label: string
  description: string
  cost: string
  output: string
}> = [
  {
    value: 'light',
    label: '轻度增强',
    description: '轻微去噪和锐化，适合快速改善压缩感。',
    cost: '最快',
    output: '保持原尺寸'
  },
  {
    value: 'clarity',
    label: '清晰增强',
    description: '更强去噪、对比度和细节增强，适合普通短视频。',
    cost: '中等',
    output: '保持原尺寸'
  },
  {
    value: 'upscale_1080p',
    label: '1080p 放大',
    description: '使用 Lanczos 放大到 1080p 级别并锐化。',
    cost: '较慢',
    output: '宽边 1920'
  },
  {
    value: 'high_fps',
    label: '高帧率',
    description: '插帧到 60fps，同时做基础去噪和锐化。',
    cost: '最慢',
    output: '60fps'
  }
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

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)
}

function addFilesToQueue(files: File[]) {
  const videoFiles = files.filter(isVideoFile)
  if (videoFiles.length === 0) {
    errorMessage.value = '请拖入视频文件。'
    return
  }

  errorMessage.value = ''
  queue.value.push(...videoFiles.map(file => ({
    id: createQueueId(),
    file,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type || '视频文件',
    previewUrl: URL.createObjectURL(file),
    preset: preset.value,
    presetLabel: activePreset.value?.label || '轻度增强',
    progress: 0,
    status: 'pending' as QueueStatus,
    result: null,
    errorMessage: ''
  })))

  if (videoFiles.length < files.length) {
    toast.warning(`已忽略 ${files.length - videoFiles.length} 个非视频文件`)
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

function runLocalEnhance(item: LocalVideoQueueItem): Promise<LocalEnhanceResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('preset', item.preset)
    formData.append('video', item.file, item.fileName)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/tools/local-video-enhance')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      item.progress = Math.min(99, Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      const response = xhr.response as LocalEnhanceResponse | { message?: string } | null
      if (xhr.status >= 200 && xhr.status < 300 && response && 'videoUrl' in response) {
        item.progress = 100
        resolve(response)
        return
      }
      reject(new Error(response && 'message' in response && response.message ? response.message : '本地增强失败'))
    }
    xhr.onerror = () => reject(new Error('本地增强失败，请确认 FFmpeg 可用'))
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
        item.errorMessage = error instanceof Error ? error.message : '本地增强失败'
        failedCount += 1
      }
    }
    if (successCount > 0) {
      toast.success(`本地增强完成 ${successCount} 个视频`)
    }
    if (failedCount > 0) {
      errorMessage.value = `${failedCount} 个视频处理失败，请检查队列中的错误信息后重试。`
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
      title="本地视频增强"
      description="使用本机 FFmpeg 对视频做基础去噪、锐化、放大或插帧，不上传云端。"
    >
      <template #actions>
        <Button
          variant="outline"
          size="sm"
          as-child
        >
          <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'video', view: 'create', mode: 'cloud' } }">
            云端 AI 增强
          </NuxtLink>
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent scroll inner-class="space-y-6">
      <Card>
        <CardHeader class="border-b">
          <CardTitle class="text-lg">
            本地增强工作区
          </CardTitle>
          <CardDescription>
            第一版使用传统视频滤镜，适合快速预览本地处理效果。
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-6 pt-6">
          <section class="space-y-3">
            <h2 class="text-base font-semibold text-foreground">
              增强预设
            </h2>
            <div class="grid gap-3 md:grid-cols-4">
              <button
                v-for="option in presetOptions"
                :key="option.value"
                type="button"
                class="rounded-xl bg-muted/20 p-3 text-left transition-colors hover:bg-muted/35"
                :class="preset === option.value ? 'border-primary bg-primary/5' : 'border-border'"
                @click="preset = option.value"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="text-sm font-medium text-foreground">
                    {{ option.label }}
                  </div>
                  <Badge variant="outline">
                    {{ option.cost }}
                  </Badge>
                </div>
                <div class="mt-1 text-xs leading-5 text-muted-foreground">
                  {{ option.description }}
                </div>
                <div class="mt-3 text-xs text-muted-foreground">
                  输出：<span class="text-foreground">{{ option.output }}</span>
                </div>
              </button>
            </div>
          </section>

          <section class="space-y-3 border-t pt-6">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="text-base font-semibold text-foreground">
                  源视频
                </h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  建议先用 10-30 秒短视频测试，插帧和放大会明显更耗时。
                </p>
              </div>
              <input
                ref="fileInputRef"
                type="file"
                multiple
                accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
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
                选择视频
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
                拖拽视频到这里，或点击“选择视频”
              </div>
              <div
                v-else
                class="space-y-2"
              >
                <div
                  v-for="item in queue"
                  :key="item.id"
                  class="rounded-xl bg-muted/25 p-3"
                >
                  <div class="flex items-start gap-3">
                    <FileVideo class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center justify-between gap-3">
                        <div class="truncate text-sm font-medium text-foreground">
                          {{ item.fileName }}
                        </div>
                        <div class="flex shrink-0 items-center gap-2">
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
                      <div class="mt-1 text-xs text-muted-foreground">
                      {{ formatBytes(item.fileSize) }} · {{ item.fileType }} · {{ item.presetLabel }}
                      </div>
                      <div
                        v-if="item.status === 'processing' || item.progress > 0 && item.status !== 'completed'"
                        class="mt-3 space-y-2"
                      >
                        <Progress :model-value="item.progress" />
                        <div class="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2
                            v-if="item.status === 'processing'"
                            class="h-4 w-4 animate-spin text-primary"
                          />
                          {{ item.progress < 100 ? `正在上传到本地后端：${item.progress}%` : 'FFmpeg 正在处理视频，请保持页面打开。' }}
                        </div>
                      </div>
                      <div
                        v-if="item.errorMessage"
                        class="mt-2 text-xs leading-5 text-destructive"
                      >
                        {{ item.errorMessage }}
                      </div>
                      <div
                        v-if="item.result"
                        class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground"
                      >
                        <span>{{ item.result.presetLabel }} · 处理耗时 {{ formatDuration(item.result.elapsedMs) }}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          as-child
                        >
                          <a
                            :href="item.result.videoUrl"
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink class="mr-2 h-4 w-4" />
                            打开视频
                          </a>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              v-if="errorMessage"
              class="rounded-xl bg-destructive/10 p-3 text-sm leading-6 text-destructive"
            >
              {{ errorMessage }}
            </div>

            <Button
              :disabled="!canSubmit"
              @click="submitLocalEnhance"
            >
              <Loader2
                v-if="processing"
                class="mr-2 h-4 w-4 animate-spin"
              />
              <MonitorCog
                v-else
                class="mr-2 h-4 w-4"
              />
              开始处理 {{ pendingQueue.length }} 个视频
            </Button>
            <div
              v-if="queue.length === 0"
              class="text-xs text-muted-foreground"
            >
              请先选择或拖入本地视频。
            </div>
          </section>

          <section
            v-if="queue.some(item => item.result)"
            class="space-y-3 border-t pt-6"
          >
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Sparkles class="h-4 w-4 text-primary" />
                  增强结果
                </h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  可在队列中打开每个增强结果。
                </p>
              </div>
            </div>
            <div class="grid gap-4 lg:grid-cols-2">
              <ToolsVideoCompareViewer
                v-for="item in queue.filter(value => value.result)"
                :key="item.id"
                :before-url="item.previewUrl"
                :after-url="item.result?.videoUrl || ''"
                :before-label="item.fileName"
                after-label="增强结果"
                empty-label="暂无结果"
              />
            </div>
          </section>
        </CardContent>
      </Card>
    </AppPageContent>
  </div>
</template>
