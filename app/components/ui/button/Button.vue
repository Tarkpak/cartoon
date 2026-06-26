<script setup lang="ts">
import { type HTMLAttributes, computed } from 'vue'
import { Primitive, type PrimitiveProps } from 'radix-vue'
import { type ButtonVariants, buttonVariants } from '.'
import { createClickRipple } from '@/lib/ripple'
import { cn } from '@/lib/utils'

interface Props extends PrimitiveProps {
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button'
})

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props
  return delegated
})

function handlePointerDown(event: PointerEvent) {
  if (props.variant === 'link') return
  createClickRipple(event)
}
</script>

<template>
  <Primitive
    v-bind="delegatedProps"
    :class="cn(buttonVariants({ variant, size }), props.class)"
    @pointerdown="handlePointerDown"
  >
    <slot />
  </Primitive>
</template>
