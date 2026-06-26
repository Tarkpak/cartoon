<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div :class="cn('flex h-full min-h-0 flex-col overflow-hidden bg-background', props.class)">
    <slot />
  </div>
</template>
