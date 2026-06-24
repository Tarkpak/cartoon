<script setup lang="ts">
import { FileImage, ListChecks, Loader2, Upload, WandSparkles } from 'lucide-vue-next'

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
}

const router = useRouter()
const route = useRoute()
const { toast } = useToast()

const kind = ref<EnhanceKind>('standard')
const sourceImageUrl = ref('')
const sourceObjectKey = ref('')
const selectedFileName = ref('')
const selectedFileSize = ref(0)
const selectedFileType = ref('')
const previewUrl = ref('')
const scale = ref('2')
const outputFormat = ref('original')
const submitting = ref(false)
const uploadingSource = ref(false)
const uploadProgress = ref(0)
const errorMessage = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

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

const sourceUploaded = computed(() => sourceImageUrl.value.trim().length > 0 && !uploadingSource.value)
const canSubmit = computed(() => sourceUploaded.value && !submitting.value)
const activeKindOption = computed(() => kindOptions.find(option => option.value === kind.value))
const submitHint = computed(() => {
  if (submitting.value) return '正在提交任务，请稍候。'
  if (uploadingSource.value) return '源图片正在上传，上传完成后才能提交。'
  if (!sourceImageUrl.value.trim()) return '请先选择并上传一张本地图片。'
  return ''
})

watch(kind, (value) => {
  if (value !== 'upscale') {
    scale.value = '2'
  }
})

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

function buildRequestBody() {
  const body: Record<string, unknown> = {
    kind: kind.value,
    imageUrl: sourceImageUrl.value.trim(),
    sourceFileName: selectedFileName.value || '本地图片',
    sourceObjectKey: sourceObjectKey.value || undefined
  }
  if (kind.value === 'upscale') {
    body.scale = Number(scale.value)
  }
  if (outputFormat.value !== 'original') {
    body.format = outputFormat.value
  }
  return body
}

function uploadSourceImage(formData: FormData): Promise<EnhanceUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/tools/image-enhance/upload-source')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      uploadProgress.value = Math.min(99, Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      const response = xhr.response as EnhanceUploadResponse | { message?: string } | null
      if (xhr.status >= 200 && xhr.status < 300 && response && 'imageUrl' in response) {
        uploadProgress.value = 100
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
  const file = input?.files?.[0]
  if (!file) return

  uploadingSource.value = true
  uploadProgress.value = 0
  errorMessage.value = ''
  sourceImageUrl.value = ''
  sourceObjectKey.value = ''
  selectedFileName.value = file.name
  selectedFileSize.value = file.size
  selectedFileType.value = file.type || '图片文件'
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(file)
  try {
    const formData = new FormData()
    formData.append('image', file, file.name)
    const response = await uploadSourceImage(formData)
    sourceImageUrl.value = response.imageUrl
    sourceObjectKey.value = response.sourceObjectKey || ''
    toast.success('源图片上传完成', { description: file.name })
  } catch (error) {
    selectedFileName.value = ''
    selectedFileSize.value = 0
    selectedFileType.value = ''
    sourceObjectKey.value = ''
    uploadProgress.value = 0
    errorMessage.value = error instanceof Error ? error.message : '上传源图片到 TOS 失败'
  } finally {
    uploadingSource.value = false
    if (input) input.value = ''
  }
}

async function submitTask() {
  errorMessage.value = ''
  submitting.value = true
  try {
    const response = await $fetch<EnhanceSubmitResponse>('/api/tools/image-enhance', {
      method: 'POST',
      body: buildRequestBody()
    })
    await router.push({
      path: '/tools/enhance-tasks',
      query: { type: 'image', taskId: response.taskId }
    })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '提交图片增强任务失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-background p-6 lg:p-8">
    <div class="mx-auto max-w-5xl space-y-6">
      <div
        v-if="!embeddedInUnifiedEnhance"
        class="flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between"
      >
        <div>
          <div class="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <WandSparkles class="h-4 w-4" />
            工具
          </div>
          <h1 class="text-2xl font-semibold text-foreground">
            图片增强
          </h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            选择本地图片上传到 TOS 后，提交到火山引擎 AI MediaKit 进行云端增强。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" as-child>
            <NuxtLink :to="{ path: '/tools/enhance-tasks', query: { type: 'image' } }">
              <ListChecks class="mr-2 h-4 w-4" />
              任务
            </NuxtLink>
          </Button>
          <Button variant="outline" size="sm" as-child>
            <NuxtLink :to="{ path: '/tools/local-enhance', query: { type: 'image' } }">
              本地图片
            </NuxtLink>
          </Button>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader class="border-b">
            <CardTitle class="text-lg">
              源图片
            </CardTitle>
            <CardDescription>
              支持 PNG、JPG、WebP、BMP，单张上限 50MB。
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-5 pt-6">
            <input
              ref="fileInputRef"
              type="file"
              accept="image/*,.png,.jpg,.jpeg,.webp,.bmp"
              class="hidden"
              @change="handleSourceFileChange"
            >
            <div
              class="flex min-h-[280px] items-center justify-center rounded-md border border-dashed bg-muted/30 p-4"
            >
              <img
                v-if="previewUrl"
                :src="previewUrl"
                alt="源图片预览"
                class="max-h-[420px] max-w-full rounded-md object-contain"
              >
              <div v-else class="text-center">
                <FileImage class="mx-auto h-10 w-10 text-muted-foreground" />
                <p class="mt-3 text-sm text-muted-foreground">
                  选择一张图片开始增强
                </p>
              </div>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0 text-sm">
                <div v-if="selectedFileName" class="truncate font-medium text-foreground">
                  {{ selectedFileName }}
                </div>
                <div class="text-muted-foreground">
                  {{ selectedFileName ? `${selectedFileType} · ${formatBytes(selectedFileSize)}` : '尚未选择图片' }}
                </div>
              </div>
              <Button type="button" variant="outline" :disabled="uploadingSource || submitting" @click="triggerFileUpload">
                <Upload class="mr-2 h-4 w-4" />
                {{ selectedFileName ? '重新选择' : '选择图片' }}
              </Button>
            </div>
            <div v-if="uploadingSource || uploadProgress > 0" class="space-y-2">
              <Progress :model-value="uploadProgress" />
              <div class="text-xs text-muted-foreground">
                上传进度 {{ uploadProgress }}%
              </div>
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
                  class="w-full rounded-md border p-3 text-left transition-colors hover:bg-accent"
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
              <Loader2 v-if="submitting" class="mr-2 h-4 w-4 animate-spin" />
              <WandSparkles v-else class="mr-2 h-4 w-4" />
              提交云端增强
            </Button>
            <p v-if="submitHint" class="text-xs text-muted-foreground">
              {{ submitHint }}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
