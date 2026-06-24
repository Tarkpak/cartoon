<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div :class="cn('rounded-lg border border-border/70 bg-card/92 text-card-foreground shadow-[0_18px_45px_hsl(var(--foreground)/0.06)] backdrop-blur-sm transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out', props.class)">
    <slot />
  </div>
</template>
