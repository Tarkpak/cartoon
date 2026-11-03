<script setup lang="ts" generic="T extends string">
import type { Component } from 'vue'
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { cn } from '@/lib/utils'

export interface SegmentedTabItem<V extends string = string> {
  value: V
  label: string
  icon?: Component
  /** Small count shown after the label. */
  badge?: string | number
  disabled?: boolean
}

// `aria-label` (required for a11y) is read from attrs and placed on the tablist.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  items: Array<SegmentedTabItem<T>>
  size?: 'sm' | 'md'
  /** `segmented` is a pill group; `underline` is a page-level tab bar. */
  variant?: 'segmented' | 'underline'
  class?: string
}>(), {
  size: 'md',
  variant: 'segmented',
  class: undefined
})

const model = defineModel<T>({ required: true })
const attrs = useAttrs()
const ariaLabel = computed(() => attrs['aria-label'] as string | undefined)
</script>

<template>
  <TabsRoot
    :model-value="model"
    activation-mode="manual"
    @update:model-value="(value) => { model = value as T }"
  >
    <!-- Switching tabs never mutates data, so it stays usable in read-only projects -->
    <TabsList
      data-readonly-allowed
      :aria-label="ariaLabel"
      :class="cn(
        props.variant === 'segmented'
          ? 'inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-xl bg-muted/30 p-0.5'
          : 'flex min-h-10 items-end gap-6 border-b',
        props.class
      )"
    >
      <TabsTrigger
        v-for="item in props.items"
        :key="item.value"
        :value="item.value"
        :disabled="item.disabled"
        :class="cn(
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
          props.variant === 'segmented'
            ? [
                'rounded-lg px-3 text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
                props.size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm'
              ]
            : '-mb-px h-10 border-b-2 border-transparent px-0.5 text-sm text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground'
        )"
      >
        <component
          :is="item.icon"
          v-if="item.icon"
          class="shrink-0"
          :class="props.size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'"
          aria-hidden="true"
        />
        {{ item.label }}
        <span
          v-if="item.badge !== undefined && item.badge !== ''"
          class="rounded bg-muted px-1.5 text-2xs tabular-nums text-muted-foreground"
        >
          {{ item.badge }}
        </span>
      </TabsTrigger>
    </TabsList>
  </TabsRoot>
</template>
