<script setup lang="ts">
import type { DurationLevel, DurationProfile } from '#shared/utils/duration'
import {
  durationBarPercent,
  durationExactLabel,
  durationLevel,
  formatDurationMs
} from '#shared/utils/duration'

const props = withDefaults(defineProps<{
  value?: number | null
  profile?: DurationProfile
}>(), {
  value: undefined,
  profile: 'http'
})

const level = computed(() => durationLevel(props.value, props.profile))
const width = computed(() => `${durationBarPercent(props.value, props.profile)}%`)
const label = computed(() => formatDurationMs(props.value))
const title = computed(() => durationExactLabel(props.value))

const levelClasses: Record<DurationLevel, { text: string, track: string, bar: string }> = {
  neutral: {
    text: 'text-muted-foreground',
    track: 'bg-muted',
    bar: 'bg-muted-foreground/30'
  },
  normal: {
    text: 'text-foreground',
    track: 'bg-emerald-500/15',
    bar: 'bg-emerald-500'
  },
  warning: {
    text: 'text-amber-700 dark:text-amber-400',
    track: 'bg-amber-500/15',
    bar: 'bg-amber-500'
  },
  critical: {
    text: 'text-destructive',
    track: 'bg-destructive/15',
    bar: 'bg-destructive'
  }
}
</script>

<template>
  <div
    class="inline-flex min-w-[92px] items-center gap-2"
    :title="title"
    :aria-label="title"
  >
    <span
      class="min-w-[48px] whitespace-nowrap text-right font-mono text-xs tabular-nums"
      :class="levelClasses[level].text"
    >
      {{ label }}
    </span>
    <span
      class="h-1.5 w-9 shrink-0 overflow-hidden rounded-full"
      :class="levelClasses[level].track"
      aria-hidden="true"
    >
      <span
        class="block h-full rounded-full transition-[width] duration-200"
        :class="levelClasses[level].bar"
        :style="{ width }"
      />
    </span>
  </div>
</template>
