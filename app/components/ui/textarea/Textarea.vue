<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { useVModel } from '@vueuse/core'
import { cn } from '@/lib/utils'

const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  class?: HTMLAttributes['class']
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', payload: string | number): void
}>()

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue
})
</script>

<template>
  <textarea
    v-model="modelValue"
    :class="cn('flex min-h-[80px] w-full rounded-lg border-0 bg-muted/40 px-3 py-2 text-sm shadow-none placeholder:text-muted-foreground transition-[background-color,box-shadow] duration-150 hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55 disabled:cursor-not-allowed disabled:opacity-50', props.class)"
  />
</template>
