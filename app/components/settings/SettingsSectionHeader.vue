<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description?: string
}>(), {
  description: ''
})
</script>

<template>
  <div class="flex min-h-16 flex-col justify-center gap-3 @xl:flex-row @xl:items-center @xl:justify-between">
    <div class="min-w-0 space-y-1">
      <h2 class="text-lg font-semibold">
        {{ title }}
      </h2>
      <p
        v-if="description"
        class="text-sm text-muted-foreground"
      >
        {{ description }}
      </p>
    </div>

    <div
      v-if="$slots.actions"
      class="flex flex-shrink-0 flex-wrap items-center gap-2"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
