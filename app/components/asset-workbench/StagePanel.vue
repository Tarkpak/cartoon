<script setup lang="ts">
import { CircleHelp } from 'lucide-vue-next'
import type { Component } from 'vue'

withDefaults(defineProps<{
  title: string
  hint: string
  icon: Component
  cardClass?: string
  headerClass?: string
  contentClass?: string
}>(), {
  cardClass: 'flex-1 min-h-0 flex flex-col overflow-hidden',
  headerClass: 'pb-3',
  contentClass: 'flex-1 min-h-0 overflow-hidden flex flex-col gap-3'
})
</script>

<template>
  <Card :class="cardClass">
    <CardHeader :class="headerClass">
      <CardTitle class="text-base flex items-center gap-2">
        <component
          :is="icon"
          class="h-4 w-4"
        />
        {{ title }}
        <span class="relative inline-flex items-center group">
          <button
            type="button"
            class="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            aria-label="步骤提示"
          >
            <CircleHelp class="h-3.5 w-3.5" />
          </button>
          <span class="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-72 rounded-md border bg-popover px-2.5 py-2 text-[11px] font-normal leading-relaxed text-popover-foreground shadow-md group-hover:block group-focus-within:block">
            {{ hint }}
          </span>
        </span>
      </CardTitle>
    </CardHeader>
    <CardContent :class="contentClass">
      <slot />
    </CardContent>
  </Card>
</template>
