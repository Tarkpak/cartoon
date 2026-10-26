<script setup lang="ts">
import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <!-- Right padding leaves room for the close button. -->
  <div :class="cn('flex flex-col gap-1.5 pr-8 text-left', props.class)">
    <slot />
  </div>
</template>
