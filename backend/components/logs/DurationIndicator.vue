<script setup lang="ts">
import type { DurationProfile } from '@playlet-shared/utils/duration'
import {
  durationBarPercent,
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
const width = computed(() => `${durationBarPercent(props.value, props.profile)}%`)
</script>

<template>
  <span
    class="duration-indicator"
    :class="`duration-indicator--${level}`"
    :title="durationExactLabel(props.value)"
    :aria-label="durationExactLabel(props.value)"
  >
    <span class="duration-indicator__value">{{ formatDurationMs(props.value) }}</span>
    <span class="duration-indicator__track" aria-hidden="true">
      <span class="duration-indicator__bar" :style="{ width }" />
    </span>
  </span>
</template>

<style scoped>
.duration-indicator {
  display: inline-flex;
  min-width: 104px;
  align-items: center;
  gap: 8px;
  color: #344054;
  font-variant-numeric: tabular-nums;
}

.duration-indicator__value {
  min-width: 56px;
  text-align: right;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}

.duration-indicator__track {
  width: 38px;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #d1fadf;
}

.duration-indicator__bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #12b76a;
  transition: width 180ms ease;
}

.duration-indicator--warning {
  color: #b54708;
}

.duration-indicator--warning .duration-indicator__track {
  background: #fef0c7;
}

.duration-indicator--warning .duration-indicator__bar {
  background: #f79009;
}

.duration-indicator--critical {
  color: #b42318;
}

.duration-indicator--critical .duration-indicator__track {
  background: #fee4e2;
}

.duration-indicator--critical .duration-indicator__bar {
  background: #f04438;
}

.duration-indicator--neutral {
  color: #98a2b3;
}

.duration-indicator--neutral .duration-indicator__track {
  background: #eaecf0;
}

.duration-indicator--neutral .duration-indicator__bar {
  background: #98a2b3;
}
</style>
