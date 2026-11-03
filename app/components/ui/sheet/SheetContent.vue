<script setup lang="ts">
import { useCachedOverlayActive } from '@/composables/useCachedOverlayActive'
import { cn } from '@/lib/utils'
import {
  DialogContent,
  type DialogContentEmits,
  type DialogContentProps,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits
} from 'radix-vue'
import { computed, type HTMLAttributes } from 'vue'

// Side panel built on the Dialog primitive: focus trap, Escape and scroll lock
// come from radix; use it inside <Dialog> like DialogContent.
const props = defineProps<DialogContentProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<DialogContentEmits>()

const overlayActive = useCachedOverlayActive()

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props
  return delegated
})

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal v-if="overlayActive">
    <DialogOverlay
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none dark:bg-black/60"
    />
    <DialogContent
      v-bind="forwarded"
      :class="cn(
        'fixed inset-y-0 right-0 z-50 flex h-full w-96 max-w-[calc(100vw-2rem)] flex-col bg-popover text-popover-foreground shadow-[-16px_0_48px_rgb(0_0_0/0.18)] focus-visible:outline-none',
        'data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in-0 data-[state=open]:duration-200',
        'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right-6 data-[state=closed]:fade-out-0 data-[state=closed]:duration-150',
        'motion-reduce:animate-none',
        props.class
      )"
    >
      <slot />
    </DialogContent>
  </DialogPortal>
</template>
