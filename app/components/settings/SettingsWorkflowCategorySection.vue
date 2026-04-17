<script setup lang="ts">
import type {
  WorkflowImageGenerationModelOptions,
  WorkflowStep,
  KlingV3OmniVideoOptions
} from '#shared/types/workflow-models'
import {
  AlertCircle,
  CheckCircle2,
  Info
} from 'lucide-vue-next'
import {
  WORKFLOW_GEMINI_IMAGE_SIZES,
  type WorkflowConfig
} from '@/composables/useSettingsWorkflowModels'

const props = defineProps<{
  workflows: WorkflowConfig[]
  workflowSaving: boolean
  klingV3OmniOptions: KlingV3OmniVideoOptions
  imageGenerationOptions: WorkflowImageGenerationModelOptions
  getCapabilityLabel: (capability: string) => string
  getProviderLabel: (provider: string) => string
  updateWorkflowModel: (step: WorkflowStep, modelId: string) => Promise<void>
  updateVideoGenerationModelOptions: (patch: Partial<KlingV3OmniVideoOptions>) => Promise<void>
  updateWorkflowGeminiImageSize: (value: unknown) => void
  toSelectString: (value: unknown) => string
}>()

function hasCompatibleModels(workflow: WorkflowConfig) {
  return workflow.compatibleModels.length > 0
}

function getSelectedModel(workflow: WorkflowConfig) {
  return workflow.compatibleModels.find(model => model.model === workflow.selectedModel)
}

function updateKlingSound(value: unknown) {
  void props.updateVideoGenerationModelOptions({
    sound: props.toSelectString(value) === 'on' ? 'on' : 'off'
  })
}

function updateKlingMode(value: unknown) {
  void props.updateVideoGenerationModelOptions({
    mode: props.toSelectString(value) === 'std' ? 'std' : 'pro'
  })
}

function updateWorkflowSelection(step: WorkflowStep, value: unknown) {
  void props.updateWorkflowModel(step, props.toSelectString(value))
}

function updateGeminiImageSize(value: unknown) {
  props.updateWorkflowGeminiImageSize(value)
}
</script>

<template>
  <div class="space-y-4">
    <div
      v-for="workflow in props.workflows"
      :key="workflow.id"
      class="space-y-3 rounded-lg border bg-background p-4"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="font-medium">
              {{ workflow.name }}
            </h4>
            <span
              class="rounded px-1.5 py-0.5 text-[10px]"
              :class="workflow.isOverridden ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'"
            >
              {{ workflow.isOverridden ? '局部覆盖' : '继承全局' }}
            </span>
            <span
              v-for="cap in workflow.requiredCapabilities"
              :key="cap"
              class="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-900 dark:text-red-300"
            >
              {{ props.getCapabilityLabel(cap) }}
            </span>
          </div>
          <p class="mt-0.5 text-sm text-muted-foreground">
            {{ workflow.description }}
          </p>
          <div
            v-if="workflow.tips"
            class="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground"
          >
            <Info class="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{{ workflow.tips }}</span>
          </div>
        </div>

        <CheckCircle2
          v-if="workflow.selectedModel && hasCompatibleModels(workflow)"
          class="h-4 w-4 flex-shrink-0 text-green-500"
        />
        <AlertCircle
          v-else-if="!hasCompatibleModels(workflow)"
          class="h-4 w-4 flex-shrink-0 text-amber-500"
        />
      </div>

      <div v-if="hasCompatibleModels(workflow)">
        <Select
          :model-value="workflow.selectedModel || undefined"
          :disabled="props.workflowSaving"
          @update:model-value="(value) => updateWorkflowSelection(workflow.id, value)"
        >
          <SelectTrigger class="h-10 w-full text-sm disabled:opacity-50">
            <SelectValue placeholder="选择模型..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="model in workflow.compatibleModels"
              :key="model.model"
              :value="model.model"
            >
              [{{ props.getProviderLabel(model.provider) }}] {{ model.displayName }}
              <template v-if="model.capabilities.length">
                - {{ model.capabilities.slice(0, 2).join(', ') }}
              </template>
            </SelectItem>
          </SelectContent>
        </Select>

        <div
          v-if="workflow.selectedModel"
          class="mt-2 flex flex-wrap gap-1"
        >
          <span
            v-for="cap in (getSelectedModel(workflow)?.capabilities || [])"
            :key="cap"
            class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >{{ cap }}</span>
        </div>

        <p
          v-if="workflow.selectedModel && getSelectedModel(workflow)?.description"
          class="mt-2 text-xs text-muted-foreground"
        >
          {{ getSelectedModel(workflow)?.description }}
        </p>

        <div
          v-if="workflow.id === 'video_generation' && workflow.selectedModel === 'kling-v3-omni'"
          class="mt-3 space-y-3 rounded-lg border bg-muted/30 p-3"
        >
          <div>
            <h5 class="text-xs font-medium">
              Kling v3 Omni 额外配置
            </h5>
            <p class="mt-1 text-[11px] text-muted-foreground">
              仅对 `kling-v3-omni` 生效，会覆盖该模型默认的声音与模式参数。
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

        <div
          v-if="workflow.id === 'character_portrait'"
          class="mt-3 space-y-3 rounded-lg border bg-muted/30 p-3"
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
                  :key="`workflow_gemini_image_size_${size}`"
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

      <div
        v-else
        class="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300"
      >
        <AlertCircle class="h-4 w-4 flex-shrink-0" />
        <span>没有满足能力要求的模型</span>
      </div>
    </div>
  </div>
</template>
