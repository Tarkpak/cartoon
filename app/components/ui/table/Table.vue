<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: string
  containerClass?: string
}>()

const containerRef = ref<HTMLElement | null>(null)
const hasHorizontalOverflow = ref(false)

const overflowState = computed(() => hasHorizontalOverflow.value ? 'true' : 'false')

let resizeObserver: ResizeObserver | undefined

function updateHorizontalOverflow() {
  const element = containerRef.value
  if (!element) return
  hasHorizontalOverflow.value = element.scrollWidth > element.clientWidth + 1
}

onMounted(() => {
  void nextTick(updateHorizontalOverflow)

  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    resizeObserver = new ResizeObserver(updateHorizontalOverflow)
    resizeObserver.observe(containerRef.value)
    const table = containerRef.value.querySelector('table')
    if (table) resizeObserver.observe(table)
  }

  window.addEventListener('resize', updateHorizontalOverflow)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateHorizontalOverflow)
})
</script>

<template>
  <div
    ref="containerRef"
    :class="cn('relative w-full overflow-auto', props.containerClass)"
    :data-has-horizontal-overflow="overflowState"
  >
    <table :class="cn('w-full caption-bottom text-sm', props.class)">
      <slot />
    </table>
  </div>
</template>
