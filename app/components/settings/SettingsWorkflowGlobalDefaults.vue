<script setup lang="ts">
import type { SettingsModelConfig } from '@/lib/settings-models'
import type {
  AvailableModelsResponse,
  SelectedModels
} from '#shared/types/provider'
import type {
  WorkflowImageGenerationModelOptions,
  WorkflowCompletionNotificationOptions,
  KlingV3OmniVideoOptions,
  SeedanceVideoOptions,
  WorkflowVideoAudioDefaults,
  WorkflowPanoramaSourceMode
} from '#shared/types/workflow-models'
import { getSettingsProviderLabel, toSelectString } from '@/lib/settings-models'
import {
  getBrowserNotificationStatus,
  requestBrowserNotificationPermission,
  sendSystemNotificationTest,
  type BrowserNotificationStatus
} from '@/composables/useGenerationCompletionNotification'
import {
  WORKFLOW_GEMINI_IMAGE_SIZES,
  WORKFLOW_OPENAI_IMAGE_QUALITIES,
  WORKFLOW_PANORAMA_SOURCE_MODES,
  WORKFLOW_SEEDANCE_VIDEO_QUALITIES,
  type WorkflowConfig
} from '@/composables/useSettingsWorkflowModels'

const props = defineProps<{
  activeCategory: 'text' | 'image' | 'video'
  models: AvailableModelsResponse
  selectedModels: SelectedModels
  workflows: WorkflowConfig[]
  workflowSaving: boolean
  klingV3OmniOptions: KlingV3OmniVideoOptions
  seedanceVideoOptions: SeedanceVideoOptions
  videoAudioDefaults: WorkflowVideoAudioDefaults
  imageGenerationOptions: WorkflowImageGenerationModelOptions
  completionNotificationOptions: WorkflowCompletionNotificationOptions
  updateGlobalWorkflowDefault: (type: 'text' | 'image' | 'video' | 'tts', modelId: string) => Promise<void>
  updateVideoGenerationModelOptions: (patch: Partial<KlingV3OmniVideoOptions>) => Promise<void>
  updateWorkflowGeminiImageSize: (value: unknown) => void
  updateWorkflowOpenaiImageQuality: (value: unknown) => void
  updateWorkflowPanoramaSourceMode: (value: unknown) => void
  updateWorkflowPanoramaCustomAspectRatio: (value: string) => Promise<void>
  updateWorkflowPanoramaCustomSize: (value: string) => Promise<void>
  updateWorkflowSeedanceVideoQuality: (value: unknown) => void
  updateVideoAudioDefaults: (patch: Partial<WorkflowVideoAudioDefaults>) => Promise<void>
  updateCompletionNotificationOptions: (patch: Partial<WorkflowCompletionNotificationOptions>) => Promise<void>
}>()

interface ActiveDefaultConfig {
  key: 'text' | 'image' | 'video' | 'tts'
  label: string
  description: string
  value: string
  placeholder: string
  models: SettingsModelConfig[]
}

const activeDefaultConfig = computed<ActiveDefaultConfig>(() => {
  switch (props.activeCategory) {
    case 'image':
      return {
        key: 'image',
        label: '图片生成',
        description: '未单独覆盖的角色资产与环境参考图流程默认使用这里的模型。',
        value: props.selectedModels.image,
        placeholder: '选择图片模型',
        models: props.models.image
      }
    case 'video':
      return {
        key: 'video',
        label: '视频生成',
        description: '未单独覆盖的分镜视频流程默认使用这里的模型。',
        value: props.selectedModels.video,
        placeholder: '选择视频模型',
        models: props.models.video
      }
    case 'text':
    default:
      return {
        key: 'text',
        label: '文本生成',
        description: '未单独覆盖的解析、改写与翻译流程默认使用这里的模型。',
        value: props.selectedModels.text,
        placeholder: '选择文本模型',
        models: props.models.text
      }
  }
})

/** 当前分类下是否有任一步骤使用了 kling-v3-omni */
const hasKlingV3OmniInUse = computed(() => {
  if (props.activeCategory !== 'video') return false
  return props.selectedModels.video === 'kling-v3-omni'
    || props.workflows.some(w => w.selectedModel === 'kling-v3-omni')
})

/** 当前分类下是否有任一步骤使用了 Seedance 模型 */
const hasSeedanceInUse = computed(() => {
  if (props.activeCategory !== 'video') return false
  const isSeedance = (id: string) => id.includes('seedance')
  return isSeedance(props.selectedModels.video)
    || props.workflows.some(w => w.selectedModel && isSeedance(w.selectedModel))
})

/** 当前分类下是否有任一步骤使用了 Gemini 图片模型 */
const hasGeminiImageInUse = computed(() => {
  if (props.activeCategory !== 'image') return false
  const isGemini = (id: string) => id.startsWith('gemini')
  return isGemini(props.selectedModels.image)
    || props.workflows.some(w => w.selectedModel && isGemini(w.selectedModel))
})

/** 当前分类下是否有任一步骤使用了 OpenAI gpt-image 系列模型 */
const hasOpenAIImageInUse = computed(() => {
  if (props.activeCategory !== 'image') return false
  const isOpenAIImage = (id: string) => id.trim().toLowerCase().startsWith('gpt-image')
  return isOpenAIImage(props.selectedModels.image)
    || props.workflows.some(w => w.selectedModel && isOpenAIImage(w.selectedModel))
})

function updateKlingSound(value: unknown) {
  void props.updateVideoGenerationModelOptions({
    sound: toSelectString(value) === 'on' ? 'on' : 'off'
  })
}

function updateKlingMode(value: unknown) {
  void props.updateVideoGenerationModelOptions({
    mode: toSelectString(value) === 'std' ? 'std' : 'pro'
  })
}

function updateGeminiImageSize(value: unknown) {
  props.updateWorkflowGeminiImageSize(value)
}

function updateOpenAIImageQuality(value: unknown) {
  props.updateWorkflowOpenaiImageQuality(value)
}

const PANORAMA_SOURCE_MODE_LABELS: Record<WorkflowPanoramaSourceMode, string> = {
  equirectangular_360: '360 等距柱状（2:1）',
  equirectangular_180: '180 半球等距（1:1）',
  cubemap_3x2: 'Cubemap 展开（3:2）',
  cubemap_6x1: 'Cubemap 横排（6:1）',
  custom: '自定义比例与尺寸'
}

const panoramaCustomAspectRatioDraft = ref(props.imageGenerationOptions.panoramaCustomAspectRatio)
const panoramaCustomSizeDraft = ref(props.imageGenerationOptions.panoramaCustomSize)

const panoramaSourceMode = computed(() => props.imageGenerationOptions.panoramaSourceMode)
const usingCustomPanoramaSource = computed(() => panoramaSourceMode.value === 'custom')

watch(
  () => props.imageGenerationOptions.panoramaCustomAspectRatio,
  (value) => {
    panoramaCustomAspectRatioDraft.value = value
  }
)

watch(
  () => props.imageGenerationOptions.panoramaCustomSize,
  (value) => {
    panoramaCustomSizeDraft.value = value
  }
)

function updatePanoramaSourceMode(value: unknown) {
  props.updateWorkflowPanoramaSourceMode(value)
}

function commitPanoramaCustomAspectRatio() {
  const nextValue = panoramaCustomAspectRatioDraft.value.trim()
  if (!nextValue || nextValue === props.imageGenerationOptions.panoramaCustomAspectRatio) return
  void props.updateWorkflowPanoramaCustomAspectRatio(nextValue)
}

function commitPanoramaCustomSize() {
  const nextValue = panoramaCustomSizeDraft.value.trim()
  if (!nextValue || nextValue === props.imageGenerationOptions.panoramaCustomSize) return
  void props.updateWorkflowPanoramaCustomSize(nextValue)
}

function updateSeedanceVideoQuality(value: unknown) {
  props.updateWorkflowSeedanceVideoQuality(value)
}

function updateVideoAudioDefault(provider: keyof WorkflowVideoAudioDefaults, value: unknown) {
  void props.updateVideoAudioDefaults({
    [provider]: toCheckedBoolean(value)
  })
}

const systemNotificationStatus = ref<BrowserNotificationStatus>(getBrowserNotificationStatus())
const systemNotificationTesting = ref(false)
const completionNotificationHint = ref('')

const systemNotificationSupported = computed(() => {
  return systemNotificationStatus.value.supported && systemNotificationStatus.value.secureContext
})

function toCheckedBoolean(value: unknown): boolean {
  return value === true
}

function refreshSystemNotificationStatus() {
  systemNotificationStatus.value = getBrowserNotificationStatus()
}

function resolveSystemNotificationBlockedHint(status: BrowserNotificationStatus): string {
  if (!status.supported) {
    return '当前浏览器不支持系统通知，无法申请权限。'
  }

  if (!status.secureContext) {
    return '系统通知只在 HTTPS 或 localhost 下可用，当前站点不能申请权限。'
  }

  if (status.permission === 'denied') {
    return '浏览器已拒绝系统通知，请在地址栏的站点权限里手动开启。'
  }

  return '当前没有拿到系统通知权限，系统通知不会生效。'
}

const systemNotificationPermissionLabel = computed(() => {
  const status = systemNotificationStatus.value
  if (!status.supported) return '当前浏览器不支持'
  if (!status.secureContext) return '需要 HTTPS 或 localhost'
  if (status.permission === 'granted') return '已授权'
  if (status.permission === 'denied') return '已拒绝'
  return '未授权'
})

const systemNotificationDescription = computed(() => {
  const status = systemNotificationStatus.value
  if (!status.supported) {
    return '当前浏览器不支持系统通知，可使用提示音提醒。'
  }

  if (!status.secureContext) {
    return '系统通知仅在 HTTPS 或 localhost 下可用，当前站点无法弹出授权。'
  }

  if (status.permission === 'denied') {
    return '当前浏览器已拒绝系统通知，需要先在站点权限中手动恢复。'
  }

  if (status.permission === 'granted') {
    return '当前浏览器已授权；保持页面打开或切到后台标签页时可弹出提醒。'
  }

  return '当前浏览器尚未授权；勾选或点击测试通知时会申请权限。'
})

function updateCompletionSound(value: unknown) {
  void props.updateCompletionNotificationOptions({
    sound: toCheckedBoolean(value)
  })
}

async function triggerSystemNotificationTest() {
  completionNotificationHint.value = ''
  systemNotificationTesting.value = true

  try {
    const result = await sendSystemNotificationTest()
    systemNotificationStatus.value = result.status
    completionNotificationHint.value = result.sent
      ? `已通过${result.channel === 'serviceWorker' ? 'Service Worker' : '页面通知'}发送测试通知；如果没有看到弹窗，请检查浏览器站点权限和系统通知开关。`
      : resolveSystemNotificationBlockedHint(result.status)
    return result
  } finally {
    systemNotificationTesting.value = false
  }
}

async function updateCompletionSystemNotification(value: unknown) {
  const enabled = toCheckedBoolean(value)
  completionNotificationHint.value = ''

  if (!enabled) {
    await props.updateCompletionNotificationOptions({ systemNotification: false })
    refreshSystemNotificationStatus()
    return
  }

  const status = await requestBrowserNotificationPermission()
  systemNotificationStatus.value = status

  if (!status.canNotify) {
    completionNotificationHint.value = resolveSystemNotificationBlockedHint(status)
    await props.updateCompletionNotificationOptions({ systemNotification: false })
    return
  }

  await props.updateCompletionNotificationOptions({ systemNotification: true })
  await triggerSystemNotificationTest()
}

onMounted(() => {
  refreshSystemNotificationStatus()

  if (
    props.completionNotificationOptions.systemNotification
    && !systemNotificationStatus.value.canNotify
  ) {
    completionNotificationHint.value = resolveSystemNotificationBlockedHint(systemNotificationStatus.value)
  }
})
</script>

<template>
  <div class="space-y-3 rounded-lg border bg-background p-4">
    <div>
      <h3 class="text-sm font-medium">
        全局默认模型
      </h3>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ activeDefaultConfig.description }}
      </p>
    </div>

    <div class="space-y-1.5">
      <label class="text-xs text-muted-foreground">{{ activeDefaultConfig.label }}</label>
      <Select
        :model-value="activeDefaultConfig.value"
        @update:model-value="(value) => updateGlobalWorkflowDefault(activeDefaultConfig.key, toSelectString(value))"
      >
        <SelectTrigger class="h-9 w-full text-sm">
          <SelectValue :placeholder="activeDefaultConfig.placeholder" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="model in activeDefaultConfig.models"
            :key="model.model"
            :value="model.model"
          >
            [{{ getSettingsProviderLabel(model.provider) }}] {{ model.displayName }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div>
        <h5 class="text-xs font-medium">
          生成完成提醒
        </h5>
        <p class="mt-1 text-[11px] text-muted-foreground">
          用于模型任务完成时提醒你返回页面（解析、出图、出视频等）。
        </p>
      </div>

      <div class="space-y-2">
        <label class="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
          <span class="text-xs text-foreground">播放提示音</span>
          <Switch
            :checked="props.completionNotificationOptions.sound"
            :disabled="props.workflowSaving"
            @update:checked="updateCompletionSound"
          />
        </label>

        <label class="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
          <span class="text-xs text-foreground">系统通知</span>
          <Switch
            :checked="props.completionNotificationOptions.systemNotification"
            :disabled="props.workflowSaving || !systemNotificationSupported"
            @update:checked="updateCompletionSystemNotification"
          />
        </label>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-[11px] text-muted-foreground">
          当前权限：{{ systemNotificationPermissionLabel }}
        </p>
        <Button
          v-if="systemNotificationStatus.supported"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          :disabled="props.workflowSaving || systemNotificationTesting || !systemNotificationStatus.secureContext"
          @click="triggerSystemNotificationTest"
        >
          {{ systemNotificationTesting ? '发送中...' : '测试通知' }}
        </Button>
      </div>

      <p class="text-[11px] text-muted-foreground">
        {{ systemNotificationDescription }}
      </p>

      <p
        v-if="completionNotificationHint"
        class="text-[11px]"
        :class="systemNotificationStatus.canNotify ? 'text-emerald-600' : 'text-amber-600'"
      >
        {{ completionNotificationHint }}
      </p>
    </div>

    <div
      v-if="props.activeCategory === 'image'"
      class="space-y-3 rounded-lg border bg-muted/30 p-3"
    >
      <div>
        <h5 class="text-xs font-medium">
          环境源图格式
        </h5>
        <p class="mt-1 text-[11px] text-muted-foreground">
          环境参考图会按这里指定的源图类型生成，并按该类型校验画幅比例。2:1 并非唯一选项。
        </p>
      </div>

      <div class="space-y-1.5">
        <label class="text-xs text-muted-foreground">源图类型</label>
        <Select
          :model-value="panoramaSourceMode"
          :disabled="props.workflowSaving"
          @update:model-value="updatePanoramaSourceMode"
        >
          <SelectTrigger class="h-9 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="mode in WORKFLOW_PANORAMA_SOURCE_MODES"
              :key="`global_panorama_source_mode_${mode}`"
              :value="mode"
            >
              {{ PANORAMA_SOURCE_MODE_LABELS[mode] }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div
        v-if="usingCustomPanoramaSource"
        class="grid grid-cols-1 gap-3 md:grid-cols-2"
      >
        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">自定义比例（w:h）</label>
          <Input
            v-model="panoramaCustomAspectRatioDraft"
            placeholder="例如 2:1"
            :disabled="props.workflowSaving"
            class="h-9 text-sm"
            @blur="commitPanoramaCustomAspectRatio"
            @keydown.enter.prevent="commitPanoramaCustomAspectRatio"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">自定义尺寸（w*h）</label>
          <Input
            v-model="panoramaCustomSizeDraft"
            placeholder="例如 2048*1024"
            :disabled="props.workflowSaving"
            class="h-9 text-sm"
            @blur="commitPanoramaCustomSize"
            @keydown.enter.prevent="commitPanoramaCustomSize"
          />
        </div>
      </div>

      <p class="text-[11px] text-muted-foreground">
        预设模式会自动匹配推荐比例和尺寸；自定义模式需填写合法比例与尺寸（如 3:2、1536*1024）。
      </p>
    </div>

    <!-- 视频类：默认音频配置 -->
    <div
      v-if="props.activeCategory === 'video'"
      class="space-y-3 rounded-lg border bg-muted/30 p-3"
    >
      <div>
        <h5 class="text-xs font-medium">
          视频默认音频配置
        </h5>
        <p class="mt-1 text-[11px] text-muted-foreground">
          当请求未显式传入 withAudio 时，按模型提供商使用这里的默认值。
        </p>
      </div>

      <div class="space-y-2">
        <label class="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
          <span class="text-xs text-foreground">千问（Qwen）默认生成音频</span>
          <Switch
            :checked="props.videoAudioDefaults.qwen"
            :disabled="props.workflowSaving"
            @update:checked="(value) => updateVideoAudioDefault('qwen', value)"
          />
        </label>

        <label class="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
          <span class="text-xs text-foreground">可灵（Kling）默认生成音频</span>
          <Switch
            :checked="props.videoAudioDefaults.kling"
            :disabled="props.workflowSaving"
            @update:checked="(value) => updateVideoAudioDefault('kling', value)"
          />
        </label>

        <label class="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
          <span class="text-xs text-foreground">Seedance 默认生成音频</span>
          <Switch
            :checked="props.videoAudioDefaults.seedance"
            :disabled="props.workflowSaving"
            @update:checked="(value) => updateVideoAudioDefault('seedance', value)"
          />
        </label>
      </div>
    </div>

    <!-- 视频类：Kling V3 Omni 额外配置 -->
    <div
      v-if="hasKlingV3OmniInUse"
      class="space-y-3 rounded-lg border bg-muted/30 p-3"
    >
      <div>
        <h5 class="text-xs font-medium">
          Kling v3 Omni 额外配置
        </h5>
        <p class="mt-1 text-[11px] text-muted-foreground">
          仅当视频流程使用 kling-v3-omni 模型时生效。
        </p>
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">配音选项</label>
          <Select
            :model-value="props.klingV3OmniOptions.sound"
            :disabled="props.workflowSaving"
            @update:model-value="updateKlingSound"
          >
            <SelectTrigger class="h-9 w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">
                不生成声音（默认）
              </SelectItem>
              <SelectItem value="on">
                同时生成声音
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">生成模式</label>
          <Select
            :model-value="props.klingV3OmniOptions.mode"
            :disabled="props.workflowSaving"
            @update:model-value="updateKlingMode"
          >
            <SelectTrigger class="h-9 w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="std">
                标准模式（性价比高）
              </SelectItem>
              <SelectItem value="pro">
                专业模式（画质更高）
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>

    <!-- 视频类：Seedance 额外配置 -->
    <div
      v-if="hasSeedanceInUse"
      class="space-y-3 rounded-lg border bg-muted/30 p-3"
    >
      <div>
        <h5 class="text-xs font-medium">
          Seedance 额外配置
        </h5>
        <p class="mt-1 text-[11px] text-muted-foreground">
          仅当视频流程使用 Seedance 系列模型时生效。
        </p>
      </div>

      <div class="space-y-1.5">
        <label class="text-xs text-muted-foreground">画质（resolution）</label>
        <Select
          :model-value="props.seedanceVideoOptions.quality"
          :disabled="props.workflowSaving"
          @update:model-value="updateSeedanceVideoQuality"
        >
          <SelectTrigger class="h-9 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="quality in WORKFLOW_SEEDANCE_VIDEO_QUALITIES"
              :key="`global_seedance_video_quality_${quality}`"
              :value="quality"
            >
              {{ quality }}
            </SelectItem>
          </SelectContent>
        </Select>
        <p class="text-[11px] text-muted-foreground">
          Seedance 2.0 支持 480p / 720p / 1080p；Seedance 2.0 Fast 仅支持 480p / 720p，选择 1080p 时会自动回退到 720p。
        </p>
      </div>
    </div>

    <!-- 图片类：模型画质配置 -->
    <div
      v-if="hasGeminiImageInUse || hasOpenAIImageInUse"
      class="space-y-3 rounded-lg border bg-muted/30 p-3"
    >
      <div>
        <h5 class="text-xs font-medium">
          图片生成额外配置
        </h5>
        <p class="mt-1 text-[11px] text-muted-foreground">
          对角色资产生成和环境参考图生成统一生效；不同图片模型按各自能力读取对应配置项。
        </p>
      </div>

      <div
        v-if="hasGeminiImageInUse"
        class="space-y-1.5"
      >
        <label class="text-xs text-muted-foreground">Gemini 画质（image_size）</label>
        <Select
          :model-value="props.imageGenerationOptions.geminiImageSize"
          :disabled="props.workflowSaving"
          @update:model-value="updateGeminiImageSize"
        >
          <SelectTrigger class="h-9 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="size in WORKFLOW_GEMINI_IMAGE_SIZES"
              :key="`global_gemini_image_size_${size}`"
              :value="size"
            >
              {{ size }}
            </SelectItem>
          </SelectContent>
        </Select>
        <p class="text-[11px] text-muted-foreground">
          支持 1K / 2K / 4K；512 仅 Gemini 3.1 Flash Image 支持，其他模型会自动回退到 1K。
        </p>
      </div>

      <div
        v-if="hasOpenAIImageInUse"
        class="space-y-1.5"
      >
        <label class="text-xs text-muted-foreground">OpenAI 画质（quality）</label>
        <Select
          :model-value="props.imageGenerationOptions.openaiImageQuality"
          :disabled="props.workflowSaving"
          @update:model-value="updateOpenAIImageQuality"
        >
          <SelectTrigger class="h-9 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="quality in WORKFLOW_OPENAI_IMAGE_QUALITIES"
              :key="`global_openai_image_quality_${quality}`"
              :value="quality"
            >
              {{ quality }}
            </SelectItem>
          </SelectContent>
        </Select>
        <p class="text-[11px] text-muted-foreground">
          gpt-image 系列支持 auto / low / medium / high。
        </p>
      </div>
    </div>
  </div>
</template>
