<script setup lang="ts">
import type { CheckboxRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { Check } from 'lucide-vue-next'
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui'
import { cn } from '@/lib/utils'

type CheckedValue = boolean | 'indeterminate'

const props = defineProps<CheckboxRootProps & {
  checked?: CheckedValue
  class?: HTMLAttributes['class']
}>()

const emits = defineEmits<{
  (e: 'update:modelValue' | 'update:checked', value: CheckedValue): void
}>()

const delegatedProps = reactiveOmit(props, 'class', 'checked')

const modelValue = computed<CheckedValue | null | undefined>(() => {
  if (props.checked !== undefined) return props.checked
  return props.modelValue as CheckedValue | null | undefined
})

function handleUpdateModelValue(value: CheckedValue) {
  emits('update:modelValue', value)
  emits('update:checked', value)
}
</script>

<template>
  <CheckboxRoot
    v-bind="delegatedProps"
    :model-value="modelValue"
    :class="
      cn('grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
         props.class)"
    @update:model-value="handleUpdateModelValue"
  >
    <CheckboxIndicator class="grid place-content-center text-current">
      <slot>
        <Check class="h-4 w-4" />
      </slot>
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
