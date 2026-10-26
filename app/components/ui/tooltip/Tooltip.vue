<script setup lang="ts">
import type { TooltipRootEmits, TooltipRootProps } from 'reka-ui'
import { TooltipProvider, TooltipRoot, useForwardPropsEmits } from 'reka-ui'

const props = withDefaults(defineProps<TooltipRootProps>(), {
  delayDuration: 300
})
const emits = defineEmits<TooltipRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <!-- Self-contained provider so a tooltip works anywhere without app-level setup -->
  <TooltipProvider :delay-duration="props.delayDuration">
    <TooltipRoot v-bind="forwarded">
      <slot />
    </TooltipRoot>
  </TooltipProvider>
</template>
