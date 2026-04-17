<script setup lang="ts">
import type { SettingsModelConfig } from '@/lib/settings-models'
import type {
  AvailableModelsResponse,
  SelectedModels
} from '#shared/types/provider'
import type {
  WorkflowImageGenerationModelOptions,
  KlingV3OmniVideoOptions
} from '#shared/types/workflow-models'
import { getSettingsProviderLabel, toSelectString } from '@/lib/settings-models'
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
  updateGlobalWorkflowDefault: (type: 'text' | 'image' | 'video' | 'tts', modelId: string) => Promise<void>
  updateVideoGenerationModelOptions: (patch: Partial<KlingV3OmniVideoOptions>) => Promise<void>
  updateWorkflowGeminiImageSize: (value: unknown) => void
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
          <label class="text-xs text-muted-foreground">sound（是否生成声音）</label>
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
                off（默认，不生成声音）
              </SelectItem>
              <SelectItem value="on">
                on（同时生成声音）
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">mode（生成模式）</label>
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
                std（标准模式，性价比高）
              </SelectItem>
              <SelectItem value="pro">
                pro（专家模式，画质更高）
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
          支持 `1K` / `2K` / `4K`；`512` 仅 `Gemini 3.1 Flash Image` 支持，其他模型会自动回退到 `1K`。
        </p>
      </div>
    </div>
  </div>
</template>
