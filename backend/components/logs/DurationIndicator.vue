<script setup lang="ts">
import type { DurationProfile } from '@playlet-shared/utils/duration'
import {
  durationExactLabel,
  durationLevel,
  formatDurationMs
} from '@playlet-shared/utils/duration'

const props = withDefaults(defineProps<{
  value?: number | null
  profile?: DurationProfile
}>(), {
  value: undefined,
  profile: 'model'
})

const level = computed(() => durationLevel(props.value, props.profile))
</script>

<template>
  <span
    class="duration-indicator"
    :class="`duration-indicator--${level}`"
    :title="durationExactLabel(props.value)"
    :aria-label="durationExactLabel(props.value)"
  >
    <span class="duration-indicator__value">{{ formatDurationMs(props.value) }}</span>
  </span>
</template>

<style scoped>
.duration-indicator {
  display: inline-block;
  color: #344054;
  font-variant-numeric: tabular-nums;
}

.duration-indicator__value {
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}

.duration-indicator--warning {
  color: #b54708;
}

.duration-indicator--critical {
  color: #b42318;
}

.duration-indicator--neutral {
  color: #98a2b3;
}

</style>
