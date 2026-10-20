<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import type { ScriptParseMode } from '#shared/types/script'
import { resolveVideoWorkflowPreset } from '#shared/types/video-workflow'
import type {
  AutoStageKey,
  AutoStageStatus
} from '~/lib/asset-workbench-types'

const props = defineProps<{
  projectName: string
  projectDescription: string
  selectedStyleId: string
  projectStyleId: string
  scriptParseMode: ScriptParseMode
  projectAspectRatio: string
  stages: Array<{ key: AutoStageKey, label: string, status: AutoStageStatus }>
  activeStage: AutoStageKey
  autoRunError?: string | null
  saveError?: string | null
  saveWarning?: string | null
}>()

const workflowPreset = computed(() => resolveVideoWorkflowPreset(props.scriptParseMode))
const styleSummary = computed(() => {
  if (workflowPreset.value.stylePickerMode === 'hidden') {
    return `视觉风格 ${workflowPreset.value.name}默认`
  }
  return `画风 ${props.selectedStyleId || props.projectStyleId || '未选择'}`
})

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'select-stage', stage: AutoStageKey): void
}>()
</script>

<template>
  <div class="flex shrink-0 flex-col gap-1.5 border-b pb-2">
    <div class="flex flex-wrap items-center gap-3 lg:flex-nowrap">
      <div class="flex min-w-0 items-center gap-2 lg:max-w-sm">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0 rounded-full"
          aria-label="返回项目列表"
          title="返回项目列表"
          @click="emit('back')"
        >
          <ArrowLeft class="h-4 w-4" />
        </Button>
        <div class="min-w-0" :title="[projectDescription, styleSummary, projectAspectRatio].filter(Boolean).join(' · ')">
          <h1 :title="projectName" class="truncate text-base font-semibold leading-5 tracking-tight">
            {{ projectName || 'AI 视频创作工作台' }}
          </h1>
        </div>
      </div>
      <div class="min-w-0 shrink-0 lg:ml-auto">
        <AssetWorkbenchStageSwitcher
          :stages="stages"
          :active-stage="activeStage"
          :auto-run-error="autoRunError"
          :save-error="saveError"
          :save-warning="saveWarning"
          @select-stage="emit('select-stage', $event as AutoStageKey)"
        />
      </div>
      <div class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 lg:flex-nowrap">
        <slot name="actions" />
      </div>
    </div>
    <div id="workbench-stage-toolbar" class="empty:hidden" />
  </div>
</template>
