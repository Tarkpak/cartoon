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
  <div class="shrink-0 flex flex-col gap-1.5 xl:flex-row xl:items-start">
    <div class="min-w-0 xl:w-[360px]">
      <div class="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon"
          class="h-8 w-8 shrink-0"
          aria-label="返回项目列表"
          title="返回项目列表"
          @click="emit('back')"
        >
          <ArrowLeft class="h-4 w-4" />
        </Button>
        <div class="min-w-0">
          <h1 class="text-lg font-bold leading-tight">
            自动剧本视频工作台
          </h1>
          <p class="text-[11px] text-muted-foreground mt-0.5">
            {{ projectName }}<span v-if="projectDescription"> · {{ projectDescription }}</span> · 画风：{{ selectedStyleId || projectStyleId || '未选择' }} · 比例：{{ projectAspectRatio }}
          </p>
        </div>
      </div>
    </div>
    <div class="min-w-0 flex-1 space-y-1.5">
      <AssetWorkbenchStageSwitcher
        :stages="stages"
        :active-stage="activeStage"
        :auto-run-error="autoRunError"
        :save-error="saveError"
        @select-stage="emit('select-stage', $event as AutoStageKey)"
      />
    </div>
  </div>
</template>
