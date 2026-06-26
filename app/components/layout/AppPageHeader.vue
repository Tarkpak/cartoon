<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  class?: HTMLAttributes['class']
  titleClass?: HTMLAttributes['class']
  descriptionClass?: HTMLAttributes['class']
  compact?: boolean
}>(), {
  compact: false
})
</script>

<template>
  <div
    :class="cn(
      'flex w-full flex-wrap items-center justify-between gap-3 bg-background pr-4 md:pr-6',
      compact ? 'min-h-14 py-2' : 'min-h-16 py-3 md:py-0',
      props.class
    )"
  >
    <div
      v-if="title || description || $slots.default"
      class="min-w-0"
    >
      <slot>
        <h1 :class="cn('truncate text-xl font-semibold tracking-normal text-foreground', props.titleClass)">
          {{ title }}
        </h1>
        <p
          v-if="description"
          :class="cn('mt-1 text-sm text-muted-foreground', props.descriptionClass)"
        >
          {{ description }}
        </p>
      </slot>
    </div>

    <div
      v-if="$slots.actions"
      class="flex shrink-0 flex-wrap items-center gap-2"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
