<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div :class="cn('rounded-xl border-0 bg-muted/30 text-card-foreground shadow-none transition-[background-color,box-shadow,transform] duration-200 ease-out', props.class)">
    <slot />
  </div>
</template>
