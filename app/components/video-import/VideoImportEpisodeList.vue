<script setup lang="ts">
import { AlertCircle, Ban, CheckCircle2, Loader2, RotateCcw } from 'lucide-vue-next'
import type { VideoImportTask } from '@/composables/useVideoImport'
import {
  friendlyVideoImportError,
  isVideoImportRunning,
  videoImportStatusLabel
} from '~/lib/video-import-workflow'

defineProps<{
  episodes: VideoImportTask[]
  selectedNumber: number | null
  retryingId?: string | null
  acting?: boolean
}>()

const emit = defineEmits<{
  select: [episodeNumber: number]
  retry: [taskId: string]
}>()

function canRetry(episode: VideoImportTask) {
  return episode.status === 'failed' || episode.status === 'cancelled'
}
</script>

<template>
  <nav class="flex min-h-0 flex-col" aria-label="分集">
    <div class="px-3 pb-2 pt-3 text-xs font-medium text-muted-foreground">
      分集 · {{ episodes.length }}
    </div>
    <ul class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
      <li v-for="episode in episodes" :key="episode.id">
        <div
          class="group flex items-center gap-1 rounded-lg border-l-2 transition-colors hover:bg-muted"
          :class="selectedNumber === episode.episodeNumber ? 'border-primary bg-muted' : 'border-transparent'"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :title="`${episode.originalFilename} · ${videoImportStatusLabel(episode.status)}${episode.errorMessage ? `\n${friendlyVideoImportError(episode.errorMessage)}` : ''}`"
            @click="episode.episodeNumber && emit('select', episode.episodeNumber)"
          >
            <span class="flex h-4 w-4 shrink-0 items-center justify-center" :aria-label="videoImportStatusLabel(episode.status)">
              <Loader2 v-if="isVideoImportRunning(episode.status)" class="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
              <AlertCircle v-else-if="episode.status === 'failed'" class="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
              <Ban v-else-if="episode.status === 'cancelled'" class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <CheckCircle2 v-else class="h-3.5 w-3.5 text-success" aria-hidden="true" />
            </span>
            <span
              class="min-w-0 flex-1 truncate"
              :class="selectedNumber === episode.episodeNumber ? 'font-semibold text-foreground' : 'text-muted-foreground'"
            >
              第{{ episode.episodeNumber || '-' }}集
            </span>
          </button>
          <Button
            v-if="canRetry(episode)"
            v-tooltip="'重新识别这一集'"
            variant="ghost"
            size="icon"
            class="mr-1 h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            :disabled="acting || !!retryingId"
            :aria-label="`重新识别第${episode.episodeNumber}集`"
            @click="emit('retry', episode.id)"
          >
            <Loader2 v-if="retryingId === episode.id" class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <RotateCcw v-else class="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </li>
    </ul>
  </nav>
</template>
