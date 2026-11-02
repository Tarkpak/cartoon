<script setup lang="ts">
import type { ImageModelConfig } from '#shared/types/provider'
import type {
  WorkflowImageGenerationModelOptions,
  WorkflowImageStep,
  WorkflowImageStepOverride
} from '#shared/types/workflow-models'
import { OPENAI_IMAGE_RESOLUTIONS } from '#shared/types/workflow-models'
import {
  WORKFLOW_GEMINI_IMAGE_SIZES,
  WORKFLOW_IMAGE_OVERRIDE_INHERIT,
  WORKFLOW_OPENAI_IMAGE_QUALITIES
} from '@/composables/useSettingsWorkflowModels'

const props = defineProps<{
  step: WorkflowImageStep
  modelId: string
  provider: string
  imageModels: ImageModelConfig[]
  options: WorkflowImageGenerationModelOptions
  disabled: boolean
  update: (step: WorkflowImageStep, key: keyof WorkflowImageStepOverride, value: unknown) => void
}>()

const modelConfig = computed(() => props.imageModels.find(model => model.model === props.modelId))

const isGemini = computed(() => props.provider === 'gemini' || props.modelId.startsWith('gemini'))
const supportsResolution = computed(() => Boolean(modelConfig.value?.supportedResolutions?.length))
const isOpenAIImage = computed(() => props.modelId.trim().toLowerCase().startsWith('gpt-image') || supportsResolution.value)

const override = computed<WorkflowImageStepOverride>(() => props.options.stepOverrides?.[props.step] || {})

function selectValue(key: keyof WorkflowImageStepOverride) {
  return override.value[key] || WORKFLOW_IMAGE_OVERRIDE_INHERIT
}
</script>

<template>
  <div
    v-if="isGemini || isOpenAIImage"
    class="mt-3 grid gap-3 rounded-lg border border-border/60 p-3 @md:grid-cols-2"
  >
    <p class="text-xs text-muted-foreground @md:col-span-2">
      该类型图片的输出规格；选择「跟随全局」时使用上方图片生成额外配置。
    </p>

    <div
      v-if="isGemini"
      class="space-y-1.5"
    >
      <label class="text-xs text-muted-foreground">Gemini 画质（image_size）</label>
      <Select
        :model-value="selectValue('geminiImageSize')"
        :disabled="props.disabled"
        @update:model-value="(value) => props.update(props.step, 'geminiImageSize', value)"
      >
        <SelectTrigger class="h-9 w-full text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="WORKFLOW_IMAGE_OVERRIDE_INHERIT">
            跟随全局（{{ props.options.geminiImageSize }}）
          </SelectItem>
          <SelectItem
            v-for="size in WORKFLOW_GEMINI_IMAGE_SIZES"
            :key="`${props.step}_gemini_image_size_${size}`"
            :value="size"
          >
            {{ size }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <template v-if="isOpenAIImage">
      <div
        v-if="supportsResolution"
        class="space-y-1.5"
      >
        <label class="text-xs text-muted-foreground">OpenAI 分辨率</label>
        <Select
          :model-value="selectValue('openaiImageResolution')"
          :disabled="props.disabled"
          @update:model-value="(value) => props.update(props.step, 'openaiImageResolution', value)"
        >
          <SelectTrigger class="h-9 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="WORKFLOW_IMAGE_OVERRIDE_INHERIT">
              跟随全局（{{ props.options.openaiImageResolution }}）
            </SelectItem>
            <SelectItem
              v-for="resolution in OPENAI_IMAGE_RESOLUTIONS"
              :key="`${props.step}_openai_image_resolution_${resolution}`"
              :value="resolution"
            >
              {{ resolution }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="space-y-1.5">
        <label class="text-xs text-muted-foreground">OpenAI 画质（quality）</label>
        <Select
          :model-value="selectValue('openaiImageQuality')"
          :disabled="props.disabled"
          @update:model-value="(value) => props.update(props.step, 'openaiImageQuality', value)"
        >
          <SelectTrigger class="h-9 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="WORKFLOW_IMAGE_OVERRIDE_INHERIT">
              跟随全局（{{ props.options.openaiImageQuality }}）
            </SelectItem>
            <SelectItem
              v-for="quality in WORKFLOW_OPENAI_IMAGE_QUALITIES"
              :key="`${props.step}_openai_image_quality_${quality}`"
              :value="quality"
            >
              {{ quality }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </template>
  </div>
</template>
