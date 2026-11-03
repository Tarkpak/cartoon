<script setup lang="ts">
import type { Component } from 'vue'
import { cn } from '@/lib/utils'

// Empty list / empty stage: say what is missing and offer the next step.
const props = withDefaults(defineProps<{
  title: string
  description?: string
  icon?: Component
  /** Primary next step, e.g. "去解析剧本". */
  actionLabel?: string
  actionDisabled?: boolean
  /** Tighter spacing for side panels and cards. */
  compact?: boolean
  class?: string
}>(), {
  description: undefined,
  icon: undefined,
  actionLabel: undefined,
  actionDisabled: false,
  compact: false,
  class: undefined
})

const emit = defineEmits<{
  action: []
}>()
</script>

<template>
  <div
    :class="cn(
      'flex flex-col items-center justify-center text-center',
      props.compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-12',
      props.class
    )"
  >
    <span
      v-if="props.icon"
      class="flex items-center justify-center rounded-full bg-muted/60 text-muted-foreground"
      :class="props.compact ? 'h-9 w-9' : 'h-11 w-11'"
      aria-hidden="true"
    >
      <component
        :is="props.icon"
        :class="props.compact ? 'h-4 w-4' : 'h-5 w-5'"
      />
    </span>
    <div class="max-w-sm space-y-1">
      <p class="text-sm font-medium text-foreground">
        {{ props.title }}
      </p>
      <p
        v-if="props.description"
        class="text-xs leading-5 text-muted-foreground"
      >
        {{ props.description }}
      </p>
    </div>
    <slot name="actions">
      <Button
        v-if="props.actionLabel"
        size="sm"
        class="mt-1"
        :disabled="props.actionDisabled"
        @click="emit('action')"
      >
        {{ props.actionLabel }}
      </Button>
    </slot>
  </div>
</template>
