<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: string
  containerClass?: string
}>()
</script>

<template>
  <div :class="cn('relative w-full overflow-auto', props.containerClass)">
    <table :class="cn('w-full caption-bottom text-sm', props.class)">
      <slot />
    </table>
  </div>
</template>
