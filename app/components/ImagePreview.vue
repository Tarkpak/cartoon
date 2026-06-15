<script setup lang="ts">
import { Download, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-vue-next'

interface ImagePreviewProps {
  src: string
  alt?: string
  open: boolean
}

const props = withDefaults(defineProps<ImagePreviewProps>(), {
  alt: '图片预览'
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const rotation = ref(0)
const scale = ref(1)
const translate = reactive({ x: 0, y: 0 })
const previewFrame = ref<HTMLElement | null>(null)
const dragging = ref(false)
const dragStart = reactive({
  pointerId: -1,
  x: 0,
  y: 0,
  translateX: 0,
  translateY: 0,
  moved: false
})
const suppressNextFrameClick = ref(false)

const minScale = 0.5
const maxScale = 6

const scaleLabel = computed(() => `${Math.round(scale.value * 100)}%`)
const imageStyle = computed(() => ({
  transform: `translate3d(${translate.x}px, ${translate.y}px, 0) rotate(${rotation.value}deg) scale(${scale.value})`,
  cursor: scale.value > 1 ? (dragging.value ? 'grabbing' : 'grab') : 'zoom-in'
}))

function close() {
  emit('update:open', false)
  resetState()
}

function resetState() {
  rotation.value = 0
  resetZoom()
}

function rotate() {
  rotation.value = (rotation.value + 90) % 360
}

function resetZoom() {
  scale.value = 1
  translate.x = 0
  translate.y = 0
  stopDragging()
}

function clampScale(value: number) {
  return Math.min(maxScale, Math.max(minScale, value))
}

function clampTranslate() {
  const frame = previewFrame.value
  if (!frame || scale.value <= 1) {
    translate.x = 0
    translate.y = 0
    return
  }

  const rect = frame.getBoundingClientRect()
  const maxX = rect.width * (scale.value - 1) / 2
  const maxY = rect.height * (scale.value - 1) / 2
  translate.x = Math.min(maxX, Math.max(-maxX, translate.x))
  translate.y = Math.min(maxY, Math.max(-maxY, translate.y))
}

function setScale(nextScale: number, origin?: { clientX: number, clientY: number }) {
  const previousScale = scale.value
  const clampedScale = clampScale(nextScale)
  if (Math.abs(clampedScale - previousScale) < 0.001) return

  const frame = previewFrame.value
  if (origin && frame) {
    const rect = frame.getBoundingClientRect()
    const offsetX = origin.clientX - rect.left - rect.width / 2 - translate.x
    const offsetY = origin.clientY - rect.top - rect.height / 2 - translate.y
    const ratio = clampedScale / previousScale
    translate.x -= offsetX * (ratio - 1)
    translate.y -= offsetY * (ratio - 1)
  }

  scale.value = clampedScale
  if (scale.value <= 1) {
    translate.x = 0
    translate.y = 0
  } else {
    clampTranslate()
  }
}

function zoomIn() {
  setScale(scale.value * 1.2)
}

function zoomOut() {
  setScale(scale.value / 1.2)
}

function handleWheel(event: WheelEvent) {
  const factor = Math.exp(-event.deltaY * 0.0015)
  setScale(scale.value * factor, {
    clientX: event.clientX,
    clientY: event.clientY
  })
}

function handlePointerDown(event: PointerEvent) {
  if (scale.value <= 1) return
  dragging.value = true
  dragStart.pointerId = event.pointerId
  dragStart.x = event.clientX
  dragStart.y = event.clientY
  dragStart.translateX = translate.x
  dragStart.translateY = translate.y
  dragStart.moved = false
  const target = event.currentTarget as HTMLElement | null
  target?.setPointerCapture?.(event.pointerId)
}

function handlePointerMove(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== dragStart.pointerId) return
  if (Math.abs(event.clientX - dragStart.x) > 3 || Math.abs(event.clientY - dragStart.y) > 3) {
    dragStart.moved = true
  }
  translate.x = dragStart.translateX + event.clientX - dragStart.x
  translate.y = dragStart.translateY + event.clientY - dragStart.y
  clampTranslate()
}

function handlePointerUp(event: PointerEvent) {
  if (event.pointerId !== dragStart.pointerId) return
  const target = event.currentTarget as HTMLElement | null
  target?.releasePointerCapture?.(event.pointerId)
  if (dragStart.moved) {
    suppressNextFrameClick.value = true
  }
  stopDragging()
}

function stopDragging() {
  dragging.value = false
  dragStart.pointerId = -1
  dragStart.moved = false
}

function handleDoubleClick(event: MouseEvent) {
  if (scale.value > 1) {
    resetZoom()
    return
  }
  setScale(2, {
    clientX: event.clientX,
    clientY: event.clientY
  })
}

function handleFrameClick(event: MouseEvent) {
  if (suppressNextFrameClick.value) {
    suppressNextFrameClick.value = false
    return
  }
  if (event.target === event.currentTarget) {
    close()
  }
}

function download() {
  const link = document.createElement('a')
  link.href = props.src
  link.download = `image-${Date.now()}.png`
  link.click()
}

// ESC 键关闭
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close()
  } else if (e.key === '+' || e.key === '=') {
    zoomIn()
  } else if (e.key === '-') {
    zoomOut()
  } else if (e.key === '0') {
    resetZoom()
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.removeEventListener('keydown', handleKeydown)
    resetState()
  }
})

watch(() => props.src, () => {
  resetState()
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-[100] flex items-center justify-center"
      >
        <!-- 背景遮罩 -->
        <div
          class="absolute inset-0 bg-black/90"
          @click="close"
        />

        <!-- 工具栏 -->
        <div class="absolute left-4 right-4 top-4 z-10 flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="icon"
            class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            title="缩小"
            aria-label="缩小"
            @click="zoomOut"
          >
            <ZoomOut class="w-5 h-5" />
          </Button>
          <div class="flex h-10 min-w-16 items-center justify-center rounded-full bg-white/10 px-3 text-sm font-medium text-white">
            {{ scaleLabel }}
          </div>
          <Button
            variant="secondary"
            size="icon"
            class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            title="放大"
            aria-label="放大"
            @click="zoomIn"
          >
            <ZoomIn class="w-5 h-5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            title="重置视图"
            aria-label="重置视图"
            @click="resetState"
          >
            <RotateCcw class="w-5 h-5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            title="旋转"
            aria-label="旋转"
            @click="rotate"
          >
            <RotateCw class="w-5 h-5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            title="下载"
            aria-label="下载"
            @click="download"
          >
            <Download class="w-5 h-5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            title="关闭"
            aria-label="关闭"
            @click="close"
          >
            <X class="w-5 h-5" />
          </Button>
        </div>

        <!-- 图片容器 -->
        <div
          ref="previewFrame"
          class="relative z-10 flex h-[90vh] w-[90vw] touch-none select-none items-center justify-center overflow-hidden"
          @click="handleFrameClick"
          @wheel.prevent="handleWheel"
          @pointerdown.stop="handlePointerDown"
          @pointermove.stop="handlePointerMove"
          @pointerup.stop="handlePointerUp"
          @pointercancel.stop="handlePointerUp"
          @dblclick.stop="handleDoubleClick"
        >
          <img
            :src="src"
            :alt="alt"
            class="max-h-full max-w-full object-contain will-change-transform"
            :style="imageStyle"
            draggable="false"
            @click.stop
          >
        </div>

        <!-- 提示 -->
        <div class="absolute bottom-4 left-1/2 max-w-[90vw] -translate-x-1/2 truncate text-sm text-white/60">
          {{ alt }}
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
