<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import type {
  AutoStageKey,
  AutoStageStatus
} from '~/lib/asset-workbench-types'

defineProps<{
  projectName: string
  projectDescription: string
  selectedStyleId: string
  projectStyleId: string
  projectAspectRatio: string
  stages: Array<{ key: AutoStageKey, label: string, status: AutoStageStatus }>
  activeStage: AutoStageKey
  autoRunError?: string | null
  saveError?: string | null
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'select-stage', stage: AutoStageKey): void
}>()
</script>

<template>
  <div class="shrink-0 space-y-2">
    <div class="flex items-center gap-3">
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
          {{ projectName || '自动剧本视频工作台' }}
        </h1>
        <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span v-if="projectDescription" class="truncate max-w-[200px]">{{ projectDescription }}</span>
          <span class="inline-flex items-center gap-1">
            <span class="inline-block h-1 w-1 rounded-full bg-muted-foreground/40" />
            画风 {{ selectedStyleId || projectStyleId || '未选择' }}
          </span>
          <span class="inline-flex items-center gap-1">
            <span class="inline-block h-1 w-1 rounded-full bg-muted-foreground/40" />
            {{ projectAspectRatio }}
          </span>
        </div>
      </div>
    </div>
    <AssetWorkbenchStageSwitcher
      :stages="stages"
      :active-stage="activeStage"
      :auto-run-error="autoRunError"
      :save-error="saveError"
      @select-stage="emit('select-stage', $event as AutoStageKey)"
    />
  </div>
</template>
