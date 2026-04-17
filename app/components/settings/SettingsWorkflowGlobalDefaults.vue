<script setup lang="ts">
import type { SettingsModelConfig } from '@/lib/settings-models'
import type {
  AvailableModelsResponse,
  SelectedModels
} from '#shared/types/provider'
import { getSettingsProviderLabel, toSelectString } from '@/lib/settings-models'

const props = defineProps<{
  activeCategory: 'text' | 'image' | 'video'
  models: AvailableModelsResponse
  selectedModels: SelectedModels
  updateGlobalWorkflowDefault: (type: 'text' | 'image' | 'video' | 'tts', modelId: string) => Promise<void>
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
  </div>
</template>
