<script setup lang="ts">
import type { DurationLevel, DurationProfile } from '#shared/utils/duration'
import {
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
const label = computed(() => formatDurationMs(props.value))
const title = computed(() => durationExactLabel(props.value))

const levelClasses: Record<DurationLevel, string> = {
  neutral: 'text-muted-foreground',
  normal: 'text-foreground',
  warning: 'text-amber-700 dark:text-amber-400',
  critical: 'text-destructive'
}
</script>

<template>
  <div
    class="inline-block whitespace-nowrap font-mono text-xs tabular-nums"
    :class="levelClasses[level]"
    :title="title"
    :aria-label="title"
  >
    {{ label }}
  </div>
</template>
