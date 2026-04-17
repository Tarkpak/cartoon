<script setup lang="ts">
import type {
  WorkflowStep
} from '#shared/types/workflow-models'
import {
  AlertCircle,
  CheckCircle2,
  Info
} from 'lucide-vue-next'
import type {
  WorkflowConfig
} from '@/composables/useSettingsWorkflowModels'

const props = defineProps<{
  workflows: WorkflowConfig[]
  workflowSaving: boolean
  getCapabilityLabel: (capability: string) => string
  getProviderLabel: (provider: string) => string
  updateWorkflowModel: (step: WorkflowStep, modelId: string) => Promise<void>
  toSelectString: (value: unknown) => string
}>()

function hasCompatibleModels(workflow: WorkflowConfig) {
  return workflow.compatibleModels.length > 0
}

function getSelectedModel(workflow: WorkflowConfig) {
  return workflow.compatibleModels.find(model => model.model === workflow.selectedModel)
}

function updateWorkflowSelection(step: WorkflowStep, value: unknown) {
  void props.updateWorkflowModel(step, props.toSelectString(value))
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
