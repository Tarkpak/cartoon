<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  options: Array<{ value: string, label: string }>
  emptyText?: string
  class?: string
}>(), {
  emptyText: '暂无可选项',
  class: undefined
})

const model = defineModel<string[]>({ default: () => [] })

function toggle(value: string) {
  model.value = model.value.includes(value)
    ? model.value.filter(item => item !== value)
    : [...model.value, value]
}
</script>

<template>
  <div
    role="group"
    :class="cn('flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-xl bg-muted/25 p-2', props.class)"
  >
    <p
      v-if="props.options.length === 0"
      class="px-1 text-xs text-muted-foreground"
    >
      {{ props.emptyText }}
    </p>
    <button
      v-for="option in props.options"
      :key="option.value"
      type="button"
      :aria-pressed="model.includes(option.value)"
      class="inline-flex h-7 max-w-full items-center gap-1 rounded-lg px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="model.includes(option.value)
        ? 'bg-primary/10 text-foreground ring-1 ring-inset ring-primary/40'
        : 'bg-background text-muted-foreground hover:text-foreground'"
      @click="toggle(option.value)"
    >
      <Check
        v-if="model.includes(option.value)"
        class="h-3 w-3 shrink-0 text-primary"
        aria-hidden="true"
      />
      <span class="truncate">{{ option.label }}</span>
    </button>
  </div>
</template>
