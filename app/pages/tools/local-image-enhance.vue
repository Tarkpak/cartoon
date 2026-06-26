<script setup lang="ts">
import { FileImage, Loader2, MonitorCog, Upload } from 'lucide-vue-next'
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

const canSubmit = computed(() => !!selectedFile.value && !processing.value)

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
  selectedFileType.value = file.type || '图片文件'
  uploadProgress.value = 0
  errorMessage.value = ''
  result.value = null
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(file)
  if (input) input.value = ''
}

function runLocalEnhance(): Promise<LocalEnhanceResponse> {
  const file = selectedFile.value
  if (!file) return Promise.reject(new Error('请先选择图片文件'))
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('preset', preset.value)
    formData.append('image', file, file.name)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/tools/local-image-enhance')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      uploadProgress.value = Math.min(99, Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      const response = xhr.response as LocalEnhanceResponse | { message?: string } | null
      if (xhr.status >= 200 && xhr.status < 300 && response && 'imageUrl' in response) {
        uploadProgress.value = 100
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
  result.value = null
  uploadProgress.value = 0
  try {
    const response = await runLocalEnhance()
    result.value = response
    toast.success('本地图片处理完成', { description: `${response.presetLabel} · ${formatDuration(response.elapsedMs)}` })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '本地图片处理失败'
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
          <NuxtLink :to="{ path: '/tools/enhance', query: { type: 'image' } }">
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
              class="rounded-md border p-3 text-left transition-colors hover:bg-accent"
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
                accept="image/*,.png,.jpg,.jpeg,.webp,.bmp"
                class="hidden"
                @change="handleFileChange"
              >
              <Button type="button" variant="outline" :disabled="processing" @click="triggerFileUpload">
                <Upload class="mr-2 h-4 w-4" />
                {{ selectedFileName ? '重新选择' : '选择图片' }}
              </Button>
            </div>

            <ToolsImageCompareViewer
              :before-url="previewUrl"
              :after-url="result?.imageUrl || ''"
              before-label="原图"
              after-label="处理结果"
              empty-label="尚未选择图片"
            />
            <div
              v-if="selectedFileName || result"
              class="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground"
            >
              <div class="flex min-w-0 items-center gap-2">
                <FileImage class="h-4 w-4 shrink-0 text-primary" />
                <span class="truncate">
                  {{ selectedFileName ? `${selectedFileName} · ${selectedFileType} · ${formatBytes(selectedFileSize)}` : '尚未选择图片' }}
                </span>
              </div>
              <div
                v-if="result"
                class="flex flex-wrap items-center gap-2"
              >
                <span>{{ result.presetLabel }} · {{ formatDuration(result.elapsedMs) }}</span>
                <Button variant="outline" size="sm" as-child>
                  <a :href="result.imageUrl" target="_blank" rel="noreferrer">打开图片</a>
                </Button>
              </div>
            </div>

            <div v-if="processing || uploadProgress > 0" class="space-y-2">
              <Progress :model-value="uploadProgress" />
              <div class="text-xs text-muted-foreground">
                上传进度 {{ uploadProgress }}%
              </div>
            </div>
            <Alert v-if="errorMessage" variant="destructive">
              <AlertDescription>{{ errorMessage }}</AlertDescription>
            </Alert>
            <div class="flex justify-end">
              <Button :disabled="!canSubmit" @click="submitLocalEnhance">
                <Loader2 v-if="processing" class="mr-2 h-4 w-4 animate-spin" />
                <MonitorCog v-else class="mr-2 h-4 w-4" />
                开始本地处理
              </Button>
            </div>
          </section>
        </CardContent>
      </Card>
    </AppPageContent>
  </div>
</template>
