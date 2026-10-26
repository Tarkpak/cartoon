<script setup lang="ts">
import { CircleHelp, TriangleAlert } from 'lucide-vue-next'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'

/** Icon + title + description used by every confirmation dialog. */
defineProps<{
  title: string
  description?: string
  variant?: 'default' | 'destructive'
}>()
</script>

<template>
  <div class="flex gap-3.5">
    <span
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
      :class="variant === 'destructive' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'"
      aria-hidden="true"
    >
      <TriangleAlert
        v-if="variant === 'destructive'"
        class="h-[18px] w-[18px]"
      />
      <CircleHelp
        v-else
        class="h-[18px] w-[18px]"
      />
    </span>
    <div class="min-w-0 space-y-1.5 pt-1">
      <DialogTitle>{{ title }}</DialogTitle>
      <DialogDescription
        v-if="description || $slots.default"
        class="whitespace-pre-line"
      >
        <slot>{{ description }}</slot>
      </DialogDescription>
    </div>
  </div>
</template>
