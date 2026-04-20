<script setup lang="ts">
import type { SettingsModelConfig } from '@/lib/settings-models'
import type {
  AvailableModelsResponse,
  SelectedModels
} from '#shared/types/provider'
import type {
  WorkflowImageGenerationModelOptions,
  WorkflowCompletionNotificationOptions,
  KlingV3OmniVideoOptions
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
  type WorkflowConfig
} from '@/composables/useSettingsWorkflowModels'

const props = defineProps<{
  activeCategory: 'text' | 'image' | 'video'
  models: AvailableModelsResponse
  selectedModels: SelectedModels
  workflows: WorkflowConfig[]
  workflowSaving: boolean
  klingV3OmniOptions: KlingV3OmniVideoOptions
  imageGenerationOptions: WorkflowImageGenerationModelOptions
  completionNotificationOptions: WorkflowCompletionNotificationOptions
  updateGlobalWorkflowDefault: (type: 'text' | 'image' | 'video' | 'tts', modelId: string) => Promise<void>
  updateVideoGenerationModelOptions: (patch: Partial<KlingV3OmniVideoOptions>) => Promise<void>
  updateWorkflowGeminiImageSize: (value: unknown) => void
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
        description: '未单独覆盖的场景视频流程默认使用这里的模型。',
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

/** 当前分类下是否有任一步骤使用了 Gemini 图片模型 */
const hasGeminiImageInUse = computed(() => {
  if (props.activeCategory !== 'image') return false
  const isGemini = (id: string) => id.startsWith('gemini')
  return isGemini(props.selectedModels.image)
    || props.workflows.some(w => w.selectedModel && isGemini(w.selectedModel))
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

    <!-- 图片类：Gemini 画质配置 -->
    <div
      v-if="hasGeminiImageInUse"
      class="space-y-3 rounded-lg border bg-muted/30 p-3"
    >
      <div>
        <h5 class="text-xs font-medium">
          图片生成额外配置
        </h5>
        <p class="mt-1 text-[11px] text-muted-foreground">
          对角色资产生成和环境参考图生成统一生效；仅 Gemini 图片模型会使用该设置。
        </p>
      </div>

      <div class="space-y-1.5">
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
    </div>
  </div>
</template>
