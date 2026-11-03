<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { cn } from '@/lib/utils'
import Select from './Select.vue'
import SelectContent from './SelectContent.vue'
import SelectItem from './SelectItem.vue'
import SelectTrigger from './SelectTrigger.vue'
import SelectValue from './SelectValue.vue'

export interface SelectFieldOption {
  value: string | number
  label: string
  disabled?: boolean
}

// reka-ui reserves the empty string for "no selection", so an empty option
// value (e.g. "未设置") is mapped to a sentinel and back.
const EMPTY_VALUE = '__select_field_empty__'

const props = withDefaults(defineProps<{
  options: SelectFieldOption[]
  placeholder?: string
  disabled?: boolean
  size?: 'sm' | 'md'
  class?: string
}>(), {
  placeholder: '请选择',
  disabled: false,
  size: 'md',
  class: undefined
})

// `aria-label` falls through from attrs onto the trigger button.
defineOptions({ inheritAttrs: false })

const model = defineModel<string | number | null | undefined>()
const attrs = useAttrs()
const ariaLabel = computed(() => attrs['aria-label'] as string | undefined)

function encode(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE
  return String(value)
}

const hasEmptyOption = computed(() => props.options.some(option => option.value === ''))

const innerValue = computed({
  get() {
    const encoded = encode(model.value)
    if (encoded === EMPTY_VALUE && !hasEmptyOption.value) return undefined
    return encoded
  },
  set(next: string | undefined) {
    if (next === undefined || next === EMPTY_VALUE) {
      model.value = ''
      return
    }
    const option = props.options.find(item => String(item.value) === next)
    model.value = option ? option.value : next
  }
})
</script>

<template>
  <Select
    v-model="innerValue"
    :disabled="props.disabled"
  >
    <SelectTrigger
      :aria-label="ariaLabel"
      :class="cn(props.size === 'sm' ? 'h-8 text-xs' : 'h-9', props.class)"
    >
      <SelectValue :placeholder="props.placeholder" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem
        v-for="option in props.options"
        :key="encode(option.value)"
        :value="encode(option.value)"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
