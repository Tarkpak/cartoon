<script setup lang="ts">
import { Check, Loader2, X } from 'lucide-vue-next'
import type { VideoImportStage } from '~/lib/video-import-workflow'

defineProps<{
  stages: VideoImportStage[]
}>()
</script>

<template>
  <ol class="grid grid-cols-4 gap-2" aria-label="转换进度">
    <li
      v-for="(stage, index) in stages"
      :key="stage.key"
      class="relative flex min-w-0 items-center gap-2"
      :aria-current="['current', 'running', 'failed'].includes(stage.state) ? 'step' : undefined"
    >
      <span
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors"
        :class="{
          'border-primary bg-primary text-primary-foreground': stage.state === 'complete',
          'border-primary bg-background text-primary ring-4 ring-primary/10': stage.state === 'current' || stage.state === 'running',
          'border-destructive bg-destructive text-destructive-foreground': stage.state === 'failed',
          'border-border bg-background text-muted-foreground': stage.state === 'upcoming'
        }"
      >
        <Check v-if="stage.state === 'complete'" class="h-3.5 w-3.5" aria-hidden="true" />
        <Loader2 v-else-if="stage.state === 'running'" class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <X v-else-if="stage.state === 'failed'" class="h-3.5 w-3.5" aria-hidden="true" />
        <template v-else>{{ index + 1 }}</template>
      </span>
      <span
        class="min-w-0 truncate text-sm"
        :class="stage.state === 'upcoming' ? 'text-muted-foreground' : 'font-medium text-foreground'"
      >
        {{ stage.label }}
      </span>
      <span
        v-if="index < stages.length - 1"
        class="hidden h-px min-w-4 flex-1 sm:block"
        :class="stage.state === 'complete' ? 'bg-primary/60' : 'bg-border'"
        aria-hidden="true"
      />
    </li>
  </ol>
</template>
