<script setup lang="ts">
import SettingsModelReasoningControl from '@/components/settings/SettingsModelReasoningControl.vue'
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

const unavailableCount = computed(() => props.workflows.filter(workflow => !hasCompatibleModels(workflow)).length)

function getWorkflowStatusLabel(workflow: WorkflowConfig) {
  if (!workflow.selectedModel) return '未配置模型'
  return workflow.isOverridden ? '局部覆盖' : '继承全局'
}

function getWorkflowStatusClass(workflow: WorkflowConfig) {
  if (!workflow.selectedModel) {
    return 'bg-warning/15 text-warning'
  }
  return workflow.isOverridden
    ? 'bg-primary/10 text-primary'
    : 'bg-muted text-muted-foreground'
}

function updateWorkflowSelection(step: WorkflowStep, value: unknown) {
  void props.updateWorkflowModel(step, props.toSelectString(value))
}
</script>

<template>
  <div class="space-y-4">
    <div
      v-if="unavailableCount > 0"
      class="flex items-start gap-2.5 rounded-xl bg-warning/10 p-4 text-sm"
      role="status"
    >
      <AlertCircle class="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
      <div class="space-y-0.5">
        <p class="font-medium text-foreground">
          {{ unavailableCount === props.workflows.length ? '当前账号还没有可用的模型' : `有 ${unavailableCount} 个流程没有可用的模型` }}
        </p>
        <p class="text-muted-foreground">
          这些流程暂时无法运行。模型供应商由管理员统一配置，请联系管理员开通。
        </p>
      </div>
    </div>
    <div
      v-for="workflow in props.workflows"
      :key="workflow.id"
      class="space-y-3 rounded-xl bg-muted/25 p-4"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="font-medium">
              {{ workflow.name }}
            </h4>
            <span
              class="rounded px-1.5 py-0.5 text-xs"
              :class="getWorkflowStatusClass(workflow)"
            >
              {{ getWorkflowStatusLabel(workflow) }}
            </span>
            <span
              v-for="cap in workflow.requiredCapabilities"
              :key="cap"
              class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              title="该流程需要的模型能力"
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
          class="h-4 w-4 flex-shrink-0 text-success"
        />
        <AlertCircle
          v-else
          class="h-4 w-4 flex-shrink-0 text-warning"
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
              :key="`${model.provider}_${model.model}`"
              :value="model.model"
            >
              [{{ props.getProviderLabel(model.provider) }}] {{ model.displayName }}
              <template v-if="model.capabilities.length">
                - {{ model.capabilities.slice(0, 2).join(', ') }}
              </template>
            </SelectItem>
          </SelectContent>
        </Select>

        <SettingsModelReasoningControl
          v-if="getSelectedModel(workflow)"
          :model="workflow.selectedModel || ''"
          :provider="getSelectedModel(workflow)!.provider"
        />

        <div
          v-if="!workflow.selectedModel"
          class="mt-2 flex items-center gap-2 rounded-lg bg-warning/10 p-3 text-sm text-warning"
        >
          <AlertCircle class="h-4 w-4 flex-shrink-0" />
          <span>还没选择模型，请在上方下拉框中选择</span>
        </div>

        <div
          v-if="workflow.selectedModel"
          class="mt-2 flex flex-wrap gap-1"
        >
          <span
            v-for="cap in (getSelectedModel(workflow)?.capabilities || [])"
            :key="cap"
            class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
          >{{ cap }}</span>
        </div>

        <p
          v-if="workflow.selectedModel && getSelectedModel(workflow)?.description"
          class="mt-2 text-xs text-muted-foreground"
        >
          {{ getSelectedModel(workflow)?.description }}
        </p>
      </div>

      <p
        v-else
        class="text-sm text-muted-foreground"
      >
        暂无可用模型
      </p>
    </div>
  </div>
</template>
