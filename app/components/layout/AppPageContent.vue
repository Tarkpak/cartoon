<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  innerClass?: HTMLAttributes['class']
  padded?: boolean
  scroll?: boolean
  fill?: boolean
}>(), {
  padded: true,
  scroll: false,
  fill: true
})
</script>

<template>
  <div
    :class="cn(
      'min-h-0',
      fill ? 'flex-1' : 'flex-none',
      scroll ? 'overflow-y-auto' : 'overflow-hidden',
      padded && 'pr-4 pb-4 md:pr-6 md:pb-6',
      props.class
    )"
  >
    <div :class="props.innerClass">
      <slot />
    </div>
  </div>
</template>
