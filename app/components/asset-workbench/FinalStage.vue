<script setup lang="ts">
import { Download, Loader2 } from 'lucide-vue-next'
import type { AutoStageKey } from '~/lib/asset-workbench-types'

defineProps<{
  hint: string
  queueDone: number
  autoRunning: boolean
  autoRunCurrentStage: AutoStageKey | null
  mergeRunning: boolean
  finalVideoUrl?: string
}>()

const emit = defineEmits<{
  (e: 'run-final'): void
}>()
</script>

<template>
  <AssetWorkbenchStagePanel
    title="步骤四：最终成片"
    :icon="Download"
    :hint="hint"
    content-class="flex-1 min-h-0 space-y-3 overflow-y-auto"
  >
    <div class="text-sm text-muted-foreground">
      当前可用于合成的场景视频：{{ queueDone }} 个
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button
        :disabled="autoRunning || mergeRunning || queueDone === 0"
        @click="emit('run-final')"
      >
        <Loader2
          v-if="mergeRunning || (autoRunning && autoRunCurrentStage === 'final')"
          class="h-4 w-4 mr-2 animate-spin"
        />
        合成最终视频
      </Button>
      <a
        v-if="finalVideoUrl"
        :href="finalVideoUrl"
        download="final-video.mp4"
        class="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm"
      >下载成片</a>
    </div>
  </AssetWorkbenchStagePanel>
</template>
