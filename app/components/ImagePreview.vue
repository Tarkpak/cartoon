<script setup lang="ts">
import { X, ZoomIn, ZoomOut, RotateCw, Download } from 'lucide-vue-next'

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

const scale = ref(1)
const rotation = ref(0)
const translateX = ref(0)
const translateY = ref(0)

// 拖拽状态
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const imageRef = ref<HTMLImageElement | null>(null)

function close() {
  emit('update:open', false)
  resetState()
}

function resetState() {
  scale.value = 1
  rotation.value = 0
  translateX.value = 0
  translateY.value = 0
}

function zoomIn() {
  scale.value = Math.min(scale.value + 0.25, 5)
}

function zoomOut() {
  const newScale = Math.max(scale.value - 0.25, 1)
  scale.value = newScale
  if (newScale === 1) {
    translateX.value = 0
    translateY.value = 0
  }
}

function rotate() {
  rotation.value = (rotation.value + 90) % 360
}

function download() {
  const link = document.createElement('a')
  link.href = props.src
  link.download = `image-${Date.now()}.png`
  link.click()
}

// 鼠标滚轮缩放
function handleWheel(e: WheelEvent) {
  e.preventDefault()
  if (e.deltaY < 0) {
    scale.value = Math.min(scale.value + 0.15, 5)
  } else {
    scale.value = Math.max(scale.value - 0.15, 1)
  }
  // 缩小到1倍时重置位置
  if (scale.value === 1) {
    translateX.value = 0
    translateY.value = 0
  }
}

// 拖拽开始
function handleMouseDown(e: MouseEvent) {
  if (scale.value <= 1) return
  isDragging.value = true
  dragStart.value = { x: e.clientX - translateX.value, y: e.clientY - translateY.value }
  document.body.style.cursor = 'grabbing'
}

// 拖拽移动
function handleMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  e.preventDefault()
  translateX.value = e.clientX - dragStart.value.x
  translateY.value = e.clientY - dragStart.value.y
}

// 拖拽结束
function handleMouseUp() {
  isDragging.value = false
  document.body.style.cursor = ''
}

// ESC 键关闭
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close()
  }
}

// 计算缩略图视口位置
const viewportStyle = computed(() => {
  if (scale.value <= 1) return { display: 'none' }

  const viewportWidth = 100 / scale.value
  const viewportHeight = 100 / scale.value

  // 计算偏移（需要考虑图片实际尺寸）
  const offsetX = 50 - viewportWidth / 2 - (translateX.value / (scale.value * 3))
  const offsetY = 50 - viewportHeight / 2 - (translateY.value / (scale.value * 3))

  return {
    width: `${viewportWidth}%`,
    height: `${viewportHeight}%`,
    left: `${Math.max(0, Math.min(100 - viewportWidth, offsetX))}%`,
    top: `${Math.max(0, Math.min(100 - viewportHeight, offsetY))}%`
  }
})

// 是否显示缩略图
const showThumbnail = computed(() => scale.value > 1)

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('keydown', handleKeydown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  } else {
    document.removeEventListener('keydown', handleKeydown)
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    resetState()
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
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
        <div class="absolute top-4 right-4 z-10 flex items-center space-x-2">
          <Button
            variant="secondary"
            size="icon"
            class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            @click="zoomOut"
          >
            <ZoomOut class="w-5 h-5" />
          </Button>
          <span class="text-white text-sm min-w-[60px] text-center">
            {{ Math.round(scale * 100) }}%
          </span>
          <Button
            variant="secondary"
            size="icon"
            class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            @click="zoomIn"
          >
            <ZoomIn class="w-5 h-5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            @click="rotate"
          >
            <RotateCw class="w-5 h-5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            @click="download"
          >
            <Download class="w-5 h-5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            @click="close"
          >
            <X class="w-5 h-5" />
          </Button>
        </div>

        <!-- 图片容器 -->
        <div
          class="relative z-10 max-w-[90vw] max-h-[90vh] overflow-hidden select-none"
          :class="scale > 1 ? 'cursor-grab' : 'cursor-zoom-in'"
          @click.stop
          @wheel.prevent="handleWheel"
          @mousedown="handleMouseDown"
        >
          <img
            ref="imageRef"
            :src="src"
            :alt="alt"
            class="max-w-full max-h-[90vh] object-contain"
            :class="isDragging ? '' : 'transition-transform duration-200'"
            :style="{
              transform: `scale(${scale}) rotate(${rotation}deg) translate(${translateX / scale}px, ${translateY / scale}px)`
            }"
            draggable="false"
          >
        </div>

        <!-- 缩略图导航 -->
        <Transition
          enter-active-class="transition-opacity duration-200"
          leave-active-class="transition-opacity duration-200"
          enter-from-class="opacity-0"
          leave-to-class="opacity-0"
        >
          <div
            v-if="showThumbnail"
            class="absolute bottom-16 right-4 z-20 w-32 h-24 rounded-lg overflow-hidden border-2 border-white/30 bg-black/50"
          >
            <img
              :src="src"
              :alt="alt"
              class="w-full h-full object-contain"
            >
            <!-- 视口指示器 -->
            <div
              class="absolute border-2 border-primary bg-primary/20 rounded-sm transition-all duration-100"
              :style="viewportStyle"
            />
          </div>
        </Transition>

        <!-- 提示 -->
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">
          {{ scale > 1 ? '拖拽移动 · ' : '' }}滚轮缩放 · 按 ESC 或点击背景关闭
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
