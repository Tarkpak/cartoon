<script setup lang="ts">
import { Download, Film, Loader2 } from 'lucide-vue-next'
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
    content-class="flex-1 min-h-0 space-y-4 overflow-y-auto"
  >
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span class="inline-block h-2 w-2 rounded-full bg-violet-500" />
        可合成视频 {{ queueDone }} 个
      </div>
    </div>

    <div class="flex items-center gap-3">
      <Button
        :disabled="autoRunning || mergeRunning || queueDone === 0"
        class="gap-2"
        @click="emit('run-final')"
      >
        <Loader2
          v-if="mergeRunning || (autoRunning && autoRunCurrentStage === 'final')"
          class="h-4 w-4 animate-spin"
        />
        <Film
          v-else
          class="h-4 w-4"
        />
        合成最终视频
      </Button>
      <a
        v-if="finalVideoUrl"
        :href="finalVideoUrl"
        download="final-video.mp4"
        class="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
      >
        <Download class="h-4 w-4" />
        下载成片
      </a>
    </div>

    <!-- Final video preview -->
    <div
      v-if="finalVideoUrl"
      class="rounded-lg border bg-muted/5"
    >
      <div class="px-4 py-3 border-b">
        <div class="text-xs font-medium text-muted-foreground">
          成片预览
        </div>
      </div>
      <div class="p-4">
        <div class="aspect-video overflow-hidden rounded-lg bg-black/90">
          <video
            :src="finalVideoUrl"
            controls
            class="h-full w-full"
          />
        </div>
      </div>
    </div>
  </AssetWorkbenchStagePanel>
</template>
