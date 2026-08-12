<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: string
}>()
</script>

<template>
  <tr :class="cn('border-b border-border/20 transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted/50', props.class)">
    <slot />
  </tr>
</template>
