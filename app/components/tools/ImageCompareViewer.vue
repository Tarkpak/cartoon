<script setup lang="ts">
import { Columns2, Image as ImageIcon, Sparkles } from 'lucide-vue-next'

type CompareMode = 'compare' | 'before' | 'after'

const props = withDefaults(defineProps<{
  beforeUrl?: string
  afterUrl?: string
  beforeLabel?: string
  afterLabel?: string
  emptyLabel?: string
}>(), {
  beforeUrl: '',
  afterUrl: '',
  beforeLabel: '原图',
  afterLabel: '增强后',
  emptyLabel: '暂无预览'
})

const mode = ref<CompareMode>('compare')
const splitValue = ref([50])
const frameRef = ref<HTMLElement | null>(null)
let dragging = false

const cleanBeforeUrl = computed(() => props.beforeUrl.trim())
const cleanAfterUrl = computed(() => props.afterUrl.trim())
const hasBefore = computed(() => cleanBeforeUrl.value.length > 0)
const hasAfter = computed(() => cleanAfterUrl.value.length > 0)
const canCompare = computed(() => hasBefore.value && hasAfter.value)
const activeSingleUrl = computed(() => {
  if (mode.value === 'before') return cleanBeforeUrl.value
  if (mode.value === 'after') return cleanAfterUrl.value
  return cleanAfterUrl.value || cleanBeforeUrl.value
})
const activeSingleLabel = computed(() => {
  if (mode.value === 'before') return props.beforeLabel
  if (mode.value === 'after') return props.afterLabel
  return cleanAfterUrl.value ? props.afterLabel : props.beforeLabel
})
const unavailableLabel = computed(() => {
  if (!hasBefore.value && hasAfter.value) return '源文件不可用，无法对比'
  if (hasBefore.value && !hasAfter.value) return '结果文件不可用，无法对比'
  return ''
})

watch(canCompare, (value) => {
  if (value) return
  if (hasAfter.value) {
    mode.value = 'after'
    return
  }
  if (hasBefore.value) {
    mode.value = 'before'
  }
}, { immediate: true })

function setMode(nextMode: CompareMode) {
  if (nextMode === 'compare' && !canCompare.value) return
  if (nextMode === 'before' && !hasBefore.value) return
  if (nextMode === 'after' && !hasAfter.value) return
  mode.value = nextMode
}

function updateSplit(event: PointerEvent) {
  const frame = frameRef.value
  if (!frame) return
  const rect = frame.getBoundingClientRect()
  if (rect.width <= 0) return
  const nextValue = ((event.clientX - rect.left) / rect.width) * 100
  splitValue.value = [Math.max(2, Math.min(98, Math.round(nextValue)))]
}

function handlePointerDown(event: PointerEvent) {
  if (!canCompare.value || mode.value !== 'compare') return
  dragging = true
  updateSplit(event)
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
}

function handlePointerMove(event: PointerEvent) {
  if (!dragging) return
  updateSplit(event)
}

function handlePointerUp() {
  dragging = false
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
}

onUnmounted(() => {
  handlePointerUp()
})
</script>

<template>
  <div class="overflow-hidden rounded-md border bg-background">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 p-2">
      <div class="flex items-center gap-2 text-sm font-medium text-foreground">
        <Columns2 class="h-4 w-4 text-primary" />
        对比预览
      </div>
      <div class="flex rounded-md border bg-background p-1">
        <button
          type="button"
          class="inline-flex h-8 items-center rounded-sm px-2.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-45"
          :class="mode === 'compare' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          :disabled="!canCompare"
          @click="setMode('compare')"
        >
          <Columns2 class="mr-1.5 h-3.5 w-3.5" />
          对比
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center rounded-sm px-2.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-45"
          :class="mode === 'before' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          :disabled="!hasBefore"
          @click="setMode('before')"
        >
          <ImageIcon class="mr-1.5 h-3.5 w-3.5" />
          {{ beforeLabel }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center rounded-sm px-2.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-45"
          :class="mode === 'after' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          :disabled="!hasAfter"
          @click="setMode('after')"
        >
          <Sparkles class="mr-1.5 h-3.5 w-3.5" />
          {{ afterLabel }}
        </button>
      </div>
    </div>

    <div
      v-if="mode === 'compare' && canCompare"
      ref="frameRef"
      class="relative h-[420px] min-h-[280px] max-h-[56vh] cursor-ew-resize touch-none select-none bg-[linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(-45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(45deg,transparent_75%,hsl(var(--muted))_75%),linear-gradient(-45deg,transparent_75%,hsl(var(--muted))_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0]"
      @pointerdown="handlePointerDown"
    >
      <img
        :src="cleanBeforeUrl"
        :alt="beforeLabel"
        class="absolute inset-0 h-full w-full object-contain"
        draggable="false"
      >
      <div
        class="absolute inset-0 overflow-hidden"
        :style="{ clipPath: `inset(0 ${100 - splitValue[0]}% 0 0)` }"
      >
        <img
          :src="cleanAfterUrl"
          :alt="afterLabel"
          class="h-full w-full object-contain"
          draggable="false"
        >
      </div>
      <div
        class="absolute bottom-0 top-0 w-px bg-primary shadow-[0_0_0_1px_hsl(var(--background))]"
        :style="{ left: `${splitValue[0]}%` }"
      />
      <div
        class="absolute top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-primary shadow-sm"
        :style="{ left: `${splitValue[0]}%` }"
      >
        <Columns2 class="h-4 w-4" />
      </div>
      <div class="absolute left-3 top-3 rounded bg-background/90 px-2 py-1 text-xs font-medium text-foreground shadow-sm">
        {{ beforeLabel }}
      </div>
      <div class="absolute right-3 top-3 rounded bg-background/90 px-2 py-1 text-xs font-medium text-foreground shadow-sm">
        {{ afterLabel }}
      </div>
    </div>

    <div
      v-else-if="activeSingleUrl"
      class="flex h-[420px] min-h-[280px] max-h-[56vh] items-center justify-center bg-[linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(-45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(45deg,transparent_75%,hsl(var(--muted))_75%),linear-gradient(-45deg,transparent_75%,hsl(var(--muted))_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0] p-3"
    >
      <img
        :src="activeSingleUrl"
        :alt="activeSingleLabel"
        class="max-h-full max-w-full rounded-md object-contain"
      >
    </div>
    <div
      v-else
      class="flex h-[320px] items-center justify-center bg-muted/20 text-sm text-muted-foreground"
    >
      {{ emptyLabel }}
    </div>

    <div
      v-if="mode === 'compare' && canCompare"
      class="border-t bg-muted/20 px-4 py-3"
    >
      <Slider
        v-model="splitValue"
        :min="2"
        :max="98"
        :step="1"
      />
    </div>
    <div
      v-else-if="unavailableLabel"
      class="border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground"
    >
      {{ unavailableLabel }}
    </div>
  </div>
</template>
