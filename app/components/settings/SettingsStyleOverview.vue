<script setup lang="ts">
import { Layers, ToggleRight, Star } from 'lucide-vue-next'
import type { StylePreset } from '#shared/types/styles'

defineProps<{
  allStylePresets: StylePreset[]
  enabledStyleCount: number
  currentDefaultStyle: StylePreset | null
  styleDefaultId: string
}>()
</script>

<template>
  <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
    <!-- Total presets -->
    <div class="group relative overflow-hidden rounded-xl border bg-card p-5 transition-colors hover:border-primary/30">
      <div class="flex items-center gap-4">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Layers class="h-5 w-5" />
        </div>
        <div>
          <p class="text-sm text-muted-foreground">
            总预设
          </p>
          <p class="text-2xl font-bold tabular-nums tracking-tight">
            {{ allStylePresets.length }}
          </p>
        </div>
      </div>
    </div>

    <!-- Enabled count -->
    <div class="group relative overflow-hidden rounded-xl border bg-card p-5 transition-colors hover:border-green-500/30">
      <div class="flex items-center gap-4">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-green-500/10 text-green-600 dark:text-green-400">
          <ToggleRight class="h-5 w-5" />
        </div>
        <div>
          <p class="text-sm text-muted-foreground">
            已启用
          </p>
          <p class="text-2xl font-bold tabular-nums tracking-tight">
            {{ enabledStyleCount }}
            <span class="text-sm font-normal text-muted-foreground">/ {{ allStylePresets.length }}</span>
          </p>
        </div>
      </div>
    </div>

    <!-- Default style -->
    <div class="group relative overflow-hidden rounded-xl border bg-card p-5 transition-colors hover:border-yellow-500/30">
      <div class="flex items-center gap-4">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
          <Star class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm text-muted-foreground">
            默认画风
          </p>
          <p class="truncate text-base font-semibold">
            {{ currentDefaultStyle?.name || '未设置' }}
          </p>
          <p
            v-if="styleDefaultId"
            class="truncate text-xs text-muted-foreground"
          >
            {{ styleDefaultId }}
          </p>
        </div>

        <div
          v-if="currentDefaultStyle?.thumbnail"
          class="h-14 w-10 shrink-0 overflow-hidden rounded-lg border bg-muted/30"
        >
          <img
            :src="currentDefaultStyle.thumbnail"
            :alt="currentDefaultStyle.name"
            class="h-full w-full object-cover"
          >
        </div>
      </div>
    </div>
  </div>
</template>
