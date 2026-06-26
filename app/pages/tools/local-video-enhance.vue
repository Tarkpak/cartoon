<script setup lang="ts">
import { ExternalLink, FileVideo, Loader2, MonitorCog, Sparkles, Upload } from 'lucide-vue-next'
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

const { toast } = useToast()
const route = useRoute()

const preset = ref<LocalEnhancePreset>('light')
const selectedFile = ref<File | null>(null)
const selectedFileName = ref('')
const selectedFileSize = ref(0)
const selectedFileType = ref('')
const previewUrl = ref('')
const uploadProgress = ref(0)
const processing = ref(false)
const errorMessage = ref('')
const result = ref<LocalEnhanceResponse | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const embeddedInUnifiedLocalEnhance = computed(() => route.path === '/tools/local-enhance')

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

const canSubmit = computed(() => !!selectedFile.value && !processing.value)
const activePreset = computed(() => presetOptions.find(option => option.value === preset.value))

onUnmounted(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
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

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) return
  selectedFile.value = file
  selectedFileName.value = file.name
  selectedFileSize.value = file.size
  selectedFileType.value = file.type || '视频文件'
  uploadProgress.value = 0
  errorMessage.value = ''
  result.value = null
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(file)
  if (input) input.value = ''
}

function runLocalEnhance(): Promise<LocalEnhanceResponse> {
  const file = selectedFile.value
  if (!file) return Promise.reject(new Error('请先选择视频文件'))
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('preset', preset.value)
    formData.append('video', file, file.name)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/tools/local-video-enhance')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      uploadProgress.value = Math.min(99, Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      const response = xhr.response as LocalEnhanceResponse | { message?: string } | null
      if (xhr.status >= 200 && xhr.status < 300 && response && 'videoUrl' in response) {
        uploadProgress.value = 100
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
  result.value = null
  uploadProgress.value = 0
  try {
    const response = await runLocalEnhance()
    result.value = response
    toast.success('本地增强完成', { description: `${response.presetLabel} · ${formatDuration(response.elapsedMs)}` })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '本地增强失败'
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
          <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'video' } }">
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
                class="rounded-md border p-3 text-left transition-colors hover:bg-accent"
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
                {{ selectedFileName ? '重新选择' : '选择视频' }}
              </Button>
            </div>

            <div
              v-if="selectedFileName"
              class="rounded-md border bg-muted/30 p-4"
            >
              <div class="flex items-start gap-3">
                <FileVideo class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium text-foreground">
                    {{ selectedFileName }}
                  </div>
                  <div class="mt-1 text-xs text-muted-foreground">
                    {{ formatBytes(selectedFileSize) }} · {{ selectedFileType }}
                  </div>
                </div>
                <Badge
                  v-if="activePreset"
                  variant="secondary"
                >
                  {{ activePreset.label }}
                </Badge>
              </div>
              <div
                v-if="processing"
                class="mt-4 space-y-2"
              >
                <Progress :model-value="uploadProgress" />
                <div class="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 class="h-4 w-4 animate-spin text-primary" />
                  {{ uploadProgress < 100 ? `正在上传到本地后端：${uploadProgress}%` : 'FFmpeg 正在处理视频，请保持页面打开。' }}
                </div>
              </div>
            </div>

            <div
              v-if="errorMessage"
              class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-6 text-destructive"
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
              开始本地增强
            </Button>
            <div
              v-if="!selectedFileName"
              class="text-xs text-muted-foreground"
            >
              请先选择一个本地视频。
            </div>
          </section>

          <section
            v-if="result"
            class="space-y-3 border-t pt-6"
          >
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Sparkles class="h-4 w-4 text-primary" />
                  增强结果
                </h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  {{ result.presetLabel }} · 处理耗时 {{ formatDuration(result.elapsedMs) }}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                as-child
              >
                <a
                  :href="result.videoUrl"
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink class="mr-2 h-4 w-4" />
                  打开视频
                </a>
              </Button>
            </div>
            <ToolsVideoCompareViewer
              :before-url="previewUrl"
              :after-url="result.videoUrl"
              before-label="原视频"
              after-label="增强结果"
              empty-label="暂无结果"
            />
          </section>
        </CardContent>
      </Card>
    </AppPageContent>
  </div>
</template>
