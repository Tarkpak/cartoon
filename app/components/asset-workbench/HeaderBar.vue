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
  <div class="shrink-0 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
    <div class="flex min-w-0 items-center gap-3 lg:max-w-sm xl:max-w-md">
      <Button
        variant="ghost"
        size="icon"
        class="h-9 w-9 shrink-0 rounded-full"
        aria-label="返回项目列表"
        title="返回项目列表"
        @click="emit('back')"
      >
        <ArrowLeft class="h-4 w-4" />
      </Button>
      <div class="min-w-0">
        <h1 class="text-lg font-semibold leading-tight tracking-tight">
          {{ projectName || 'AI 视频创作工作台' }}
        </h1>
        <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span
            v-if="projectDescription"
            class="truncate max-w-[200px]"
          >{{ projectDescription }}</span>
          <span class="inline-flex items-center gap-1">
            <span class="inline-block h-1 w-1 rounded-full bg-muted-foreground/40" />
            {{ styleSummary }}
          </span>
          <span class="inline-flex items-center gap-1">
            <span class="inline-block h-1 w-1 rounded-full bg-muted-foreground/40" />
            {{ projectAspectRatio }}
          </span>
        </div>
      </div>
    </div>
    <div class="min-w-0 lg:flex-1">
      <AssetWorkbenchStageSwitcher
        :stages="stages"
        :active-stage="activeStage"
        :auto-run-error="autoRunError"
        :save-error="saveError"
        :save-warning="saveWarning"
        @select-stage="emit('select-stage', $event as AutoStageKey)"
      />
    </div>
  </div>
</template>
