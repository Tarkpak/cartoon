<script setup lang="ts">
import { X, RotateCw, Download } from 'lucide-vue-next'

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

function close() {
  emit('update:open', false)
  resetState()
}

function resetState() {
  rotation.value = 0
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

// ESC 键关闭
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close()
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
        <div class="absolute top-4 right-4 z-10 flex items-center space-x-2">
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
          @click.stop
        >
          <img
            :src="src"
            :alt="alt"
            class="max-w-full max-h-[90vh] object-contain"
            :style="{
              transform: `rotate(${rotation}deg)`
            }"
            draggable="false"
          >
        </div>

        <!-- 提示 -->
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">
          按 ESC 或点击背景关闭
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
