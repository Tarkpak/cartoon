<script setup lang="ts">
import { ArrowLeft, Eye } from 'lucide-vue-next'
import type { ScriptParseMode } from '#shared/types/script'
import { resolveVideoWorkflowPreset } from '#shared/types/video-workflow'
import { hasWindowsTitlebarControls } from '~/lib/desktop-titlebar'
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
  stages: Array<{ key: AutoStageKey, label: string, status: AutoStageStatus, progress?: number, progressTitle?: string, hasError?: boolean }>
  activeStage: AutoStageKey
  autoRunError?: string | null
  saveError?: string | null
  saveWarning?: string | null
  /** Shown as a badge next to the title instead of a separate banner row. */
  readOnlyHint?: string | null
}>()

const workflowPreset = computed(() => resolveVideoWorkflowPreset(props.scriptParseMode))
const styleSummary = computed(() => {
  if (workflowPreset.value.stylePickerMode === 'hidden') {
    return `视觉风格 ${workflowPreset.value.name}默认`
  }
  return `画风 ${props.selectedStyleId || props.projectStyleId || '未选择'}`
})

const metaSummary = computed(() => [styleSummary.value, props.projectAspectRatio].filter(Boolean).join(' · '))
const windowsTitlebarControls = hasWindowsTitlebarControls()
async function startWindowDrag(event: PointerEvent) {
  if (!windowsTitlebarControls || event.button !== 0) return
  const target = event.target
  if (!(target instanceof Element) || target.closest('button, a, input, select, textarea, [role="button"], [data-no-window-drag]')) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().startDragging()
}

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'select-stage', stage: AutoStageKey): void
}>()
</script>

<template>
  <div class="flex shrink-0 flex-col gap-1.5 border-b pb-2" :class="windowsTitlebarControls ? '-mt-1.5' : ''" data-tauri-drag-region @pointerdown="startWindowDrag">
    <!-- Three zones: identity | stage navigation | session & tasks -->
    <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" :class="windowsTitlebarControls ? 'pr-[132px]' : ''" data-tauri-drag-region>
      <div class="flex min-w-0 items-center gap-2">
        <IconActionButton
          label="返回项目列表"
          readonly-allowed
          @click="emit('back')"
        >
          <ArrowLeft class="h-4 w-4" />
        </IconActionButton>
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-2">
            <h1 :title="projectName" class="truncate text-base font-semibold leading-5 tracking-tight">
              {{ projectName || 'AI 视频创作工作台' }}
            </h1>
            <Badge
              v-if="readOnlyHint"
              v-tooltip="readOnlyHint"
              variant="secondary"
              class="h-5 shrink-0 gap-1 px-1.5 text-2xs font-medium"
              tabindex="0"
            >
              <Eye class="h-3 w-3" aria-hidden="true" />只读
            </Badge>
          </div>
          <p
            class="truncate text-xs leading-4 text-muted-foreground"
            :title="projectDescription || metaSummary"
          >
            {{ metaSummary }}
          </p>
        </div>
      </div>
      <div class="order-last col-span-2 flex min-w-0 justify-center lg:order-none lg:col-span-1">
        <AssetWorkbenchStageSwitcher
          :stages="stages"
          :active-stage="activeStage"
          :auto-run-error="autoRunError"
          :save-error="saveError"
          :save-warning="saveWarning"
          @select-stage="emit('select-stage', $event as AutoStageKey)"
        />
      </div>
      <div class="flex min-w-0 items-center justify-end gap-1">
        <slot name="actions" />
      </div>
    </div>
    <div id="workbench-stage-toolbar" class="empty:hidden" />
  </div>
</template>
