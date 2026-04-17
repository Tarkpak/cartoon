<script setup lang="ts">
import type { StylePreset } from '#shared/types/styles'

defineProps<{
  allStylePresets: StylePreset[]
  enabledStyleCount: number
  currentDefaultStyle: StylePreset | null
  styleDefaultId: string
}>()
</script>

<template>
  <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
    <div class="rounded-lg border bg-background p-3">
      <p class="text-xs text-muted-foreground">
        总预设
      </p>
      <p class="mt-1 text-xl font-semibold">
        {{ allStylePresets.length }}
      </p>
    </div>

    <div class="rounded-lg border bg-background p-3">
      <p class="text-xs text-muted-foreground">
        已启用
      </p>
      <p class="mt-1 text-xl font-semibold">
        {{ enabledStyleCount }}
      </p>
    </div>

    <div class="rounded-lg border bg-background p-3">
      <p class="text-xs text-muted-foreground">
        默认画风
      </p>
      <div class="mt-2 flex items-center gap-3">
        <div class="h-14 w-10 flex-shrink-0 overflow-hidden rounded-md border bg-muted/40">
          <img
            v-if="currentDefaultStyle?.thumbnail"
            :src="currentDefaultStyle.thumbnail"
            :alt="currentDefaultStyle.name"
            class="h-full w-full object-contain"
          >
          <div
            v-else
            class="flex h-full w-full items-center justify-center text-xs text-muted-foreground"
          >
            无图
          </div>
        </div>

        <div class="min-w-0">
          <p class="truncate text-sm font-medium">
            {{ currentDefaultStyle?.name || '未设置' }}
          </p>
          <p class="truncate text-xs text-muted-foreground">
            {{ styleDefaultId || '-' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
