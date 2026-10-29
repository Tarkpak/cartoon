<script setup lang="ts">
import { useCachedOverlayActive } from '@/composables/useCachedOverlayActive'

const overlayActive = useCachedOverlayActive()

import { cn } from '@/lib/utils'
import {
  DialogClose,
  DialogContent,
  type DialogContentEmits,
  type DialogContentProps,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits
} from 'radix-vue'
import { X } from 'lucide-vue-next'
import { computed, type HTMLAttributes } from 'vue'

const props = defineProps<DialogContentProps & {
  class?: HTMLAttributes['class']
  overlayClass?: HTMLAttributes['class']
  /** Hide the built-in close button when the dialog provides its own. */
  hideClose?: boolean
}>()
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = computed(() => {
  const { class: _, overlayClass: _overlayClass, hideClose: _hideClose, ...delegated } = props
  return delegated
})

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal v-if="overlayActive">
    <!-- A light, slightly blurred scrim keeps the page recognisable behind the dialog. -->
    <DialogOverlay
      :class="cn(
        'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] dark:bg-black/60',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150',
        'motion-reduce:animate-none',
        props.overlayClass
      )"
    />
    <!-- Centred with translate(-50%,-50%). The enter/exit keyframes replace that transform, so they set the same offset
         (8px lower on enter) through the plugin's variables. A calc() inside the slide-in "from top" utility
         gets a minus sign prefixed, which is invalid CSS and makes the dialog fly in from the bottom-right. -->
    <DialogContent
      v-bind="forwarded"
      :class="cn(
        'fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4',
        'max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain',
        'rounded-2xl bg-popover p-6 text-popover-foreground ring-1 ring-border/60',
        'shadow-[0_1px_2px_rgb(0_0_0/0.06),0_24px_64px_-12px_rgb(0_0_0/0.3)]',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:[--tw-enter-translate-x:-50%] data-[state=open]:[--tw-enter-translate-y:calc(-50%+8px)] data-[state=open]:duration-200 data-[state=open]:ease-out',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98] data-[state=closed]:[--tw-exit-translate-x:-50%] data-[state=closed]:[--tw-exit-translate-y:-50%] data-[state=closed]:duration-150 data-[state=closed]:ease-in',
        'motion-reduce:animate-none',
        'focus-visible:outline-none',
        props.class
      )"
    >
      <slot />

      <DialogClose
        v-if="!hideClose"
        class="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
        aria-label="关闭"
      >
        <X class="h-4 w-4" />
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
