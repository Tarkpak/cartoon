<script setup lang="ts">
import { ExternalLink, ListChecks, Loader2, Upload, WandSparkles } from 'lucide-vue-next'

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
}

const router = useRouter()

const kind = ref<EnhanceKind>('standard')
const sourceVideoUrl = ref('')
const sourceObjectKey = ref('')
const selectedFileName = ref('')
const scene = ref('aigc')
const resolution = ref('1080p')
const resolutionLimit = ref(720)
const fps = ref<number | undefined>(undefined)
const resolutionMode = ref<'preset' | 'limit'>('preset')
const submitting = ref(false)
const uploadingSource = ref(false)
const errorMessage = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

const kindOptions: Array<{ value: EnhanceKind, label: string, description: string }> = [
  { value: 'standard', label: '标准版', description: '平衡处理速度、画质和成本，适合常规分发。' },
  { value: 'professional', label: '专业版', description: '投入更多算力，适合老片修复和高质量交付。' },
  { value: 'fast', label: '极速版', description: '速度优先，适合直播、短视频等时效场景。' },
  { value: 'generative', label: '大模型', description: '生成式增强修复，适合 480p 级别低清视频。' }
]

const sceneOptions = [
  { value: 'aigc', label: 'AIGC' },
  { value: 'short_series', label: '短剧' },
  { value: 'ugc', label: 'UGC 短视频' },
  { value: 'old_film', label: '老片修复' }
]

const resolutionOptions = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' }
]

const canSubmit = computed(() => sourceVideoUrl.value.trim().length > 0 && !uploadingSource.value && !submitting.value)

watch(kind, (value) => {
  if (value === 'fast' || value === 'generative') {
    scene.value = 'aigc'
    if (resolution.value === '4k') resolution.value = '720p'
  }
  if (value === 'generative') {
    resolution.value = '720p'
  }
})

function buildRequestBody() {
  const body: Record<string, unknown> = {
    kind: kind.value,
    videoUrl: sourceVideoUrl.value.trim(),
    sourceFileName: selectedFileName.value || '本地视频',
    sourceObjectKey: sourceObjectKey.value || undefined
  }
  if (kind.value === 'standard' || kind.value === 'professional') {
    body.scene = scene.value
  }
  if (resolutionMode.value === 'limit') {
    body.resolutionLimit = resolutionLimit.value
  } else {
    body.resolution = resolution.value
  }
  if (fps.value && fps.value > 0) {
    body.fps = fps.value
  }
  return body
}

function triggerFileUpload() {
  fileInputRef.value?.click()
}

async function handleSourceFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) return

  uploadingSource.value = true
  errorMessage.value = ''
  sourceVideoUrl.value = ''
  selectedFileName.value = file.name
  try {
    const formData = new FormData()
    formData.append('video', file, file.name)
    const response = await $fetch<EnhanceUploadResponse>('/api/tools/video-enhance/upload-source', {
      method: 'POST',
      body: formData
    })
    sourceVideoUrl.value = response.videoUrl
    sourceObjectKey.value = response.sourceObjectKey || ''
  } catch (error) {
    selectedFileName.value = ''
    sourceObjectKey.value = ''
    errorMessage.value = error instanceof Error ? error.message : '上传源视频到 TOS 失败'
  } finally {
    uploadingSource.value = false
    if (input) input.value = ''
  }
}

async function submitTask() {
  errorMessage.value = ''
  submitting.value = true
  try {
    const response = await $fetch<EnhanceSubmitResponse>('/api/tools/video-enhance', {
      method: 'POST',
      body: buildRequestBody()
    })
    await router.push({
      path: '/tools/video-enhance-tasks',
      query: { taskId: response.taskId }
    })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '提交画质增强任务失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-background p-6 lg:p-8">
    <div class="mx-auto max-w-5xl space-y-6">
      <div class="flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div class="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <WandSparkles class="h-4 w-4" />
            工具
          </div>
          <h1 class="text-2xl font-semibold text-foreground">
            画质增强
          </h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            选择本地视频上传到 TOS 后，提交到火山引擎 AI MediaKit 进行画质增强。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            as-child
          >
            <NuxtLink to="/tools/video-enhance-tasks">
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
              href="https://www.volcengine.com/docs/6448/2222230?lang=zh"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink class="mr-2 h-4 w-4" />
              文档
            </a>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle class="text-lg">
            提交增强
          </CardTitle>
          <CardDescription>
            本地视频会先上传到已配置的 TOS。若未启用 TOS，上传会被后端拒绝。
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-5">
          <div class="grid gap-3 md:grid-cols-4">
            <button
              v-for="option in kindOptions"
              :key="option.value"
              type="button"
              class="rounded-md border p-3 text-left transition-colors hover:bg-accent"
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

          <div class="rounded-md border bg-muted/30 p-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div class="text-sm font-medium text-foreground">
                  本地视频
                </div>
                <div class="mt-1 text-xs text-muted-foreground">
                  支持常见视频格式，上传后自动使用 TOS 公网地址提交任务。
                </div>
              </div>
              <input
                ref="fileInputRef"
                type="file"
                accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
                class="hidden"
                @change="handleSourceFileChange"
              >
              <Button
                type="button"
                variant="outline"
                :disabled="uploadingSource || submitting"
                @click="triggerFileUpload"
              >
                <Loader2
                  v-if="uploadingSource"
                  class="mr-2 h-4 w-4 animate-spin"
                />
                <Upload
                  v-else
                  class="mr-2 h-4 w-4"
                />
                {{ selectedFileName ? '重新选择' : '选择视频' }}
              </Button>
            </div>
            <div
              v-if="selectedFileName"
              class="mt-3 rounded-md bg-background px-3 py-2 text-sm text-foreground"
            >
              {{ uploadingSource ? '正在上传：' : '已上传：' }}{{ selectedFileName }}
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-3">
            <div
              v-if="kind === 'standard' || kind === 'professional'"
              class="space-y-2"
            >
              <label class="text-sm font-medium text-foreground">业务场景</label>
              <Select v-model="scene">
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

            <div class="space-y-2">
              <label class="text-sm font-medium text-foreground">分辨率方式</label>
              <Select v-model="resolutionMode">
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
              <Select v-model="resolution">
                <SelectTrigger>
                  <SelectValue placeholder="选择分辨率" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in resolutionOptions"
                    :key="option.value"
                    :value="option.value"
                    :disabled="(kind === 'fast' || kind === 'generative') && option.value === '4k'"
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
              />
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-foreground">帧率（可选）</label>
              <Input
                v-model.number="fps"
                type="number"
                min="1"
                max="120"
                placeholder="保持原帧率"
              />
            </div>
          </div>

          <div
            v-if="kind === 'generative'"
            class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
          >
            大模型版本仅适合 480p 级别输入视频，短边需在 360-520 像素之间，且仅支持 SDR 视频。
          </div>

          <div
            v-if="errorMessage"
            class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-6 text-destructive"
          >
            {{ errorMessage }}
          </div>

          <Button
            :disabled="!canSubmit"
            @click="submitTask"
          >
            <Loader2
              v-if="submitting"
              class="mr-2 h-4 w-4 animate-spin"
            />
            提交增强
          </Button>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
