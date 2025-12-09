<script setup lang="ts">
import {
  ArrowRight,
  RefreshCw,
  Download,
  ZoomIn,
  ImageIcon
} from 'lucide-vue-next'

interface FramePairProps {
  firstFrame?: string
  lastFrame?: string
  firstFrameMime?: string
  lastFrameMime?: string
  sceneTitle?: string
  loading?: boolean
}

const props = withDefaults(defineProps<FramePairProps>(), {
  firstFrameMime: 'image/png',
  lastFrameMime: 'image/png',
  sceneTitle: '场景',
  loading: false
})

const emit = defineEmits<{
  regenerateFirst: []
  regenerateLast: []
  download: [type: 'first' | 'last' | 'both']
  preview: [type: 'first' | 'last', src: string]
}>()

const firstFrameSrc = computed(() => {
  if (!props.firstFrame) return ''
  return props.firstFrame.startsWith('data:')
    ? props.firstFrame
    : `data:${props.firstFrameMime};base64,${props.firstFrame}`
})

const lastFrameSrc = computed(() => {
  if (!props.lastFrame) return ''
  return props.lastFrame.startsWith('data:')
    ? props.lastFrame
    : `data:${props.lastFrameMime};base64,${props.lastFrame}`
})

function handlePreview(type: 'first' | 'last') {
  const src = type === 'first' ? firstFrameSrc.value : lastFrameSrc.value
  if (src) {
    emit('preview', type, src)
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- 标题 -->
    <div class="flex items-center justify-between">
      <h3 class="font-semibold">
        {{ sceneTitle }} - 首尾帧
      </h3>
      <Button
        variant="outline"
        size="sm"
        :disabled="!firstFrame || !lastFrame"
        @click="emit('download', 'both')"
      >
        <Download class="w-4 h-4 mr-2" />
        下载全部
      </Button>
    </div>

    <!-- 帧对比 -->
    <div class="grid grid-cols-2 gap-4">
      <!-- 首帧 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between text-sm">
          <span class="text-muted-foreground">首帧</span>
          <div class="flex space-x-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :disabled="!firstFrame"
              @click="handlePreview('first')"
            >
              <ZoomIn class="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              @click="emit('regenerateFirst')"
            >
              <RefreshCw class="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <div class="aspect-video rounded-lg overflow-hidden bg-muted border">
          <div
            v-if="loading && !firstFrame"
            class="w-full h-full flex items-center justify-center"
          >
            <RefreshCw class="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
          <div
            v-else-if="!firstFrame"
            class="w-full h-full flex items-center justify-center"
          >
            <div class="text-center text-muted-foreground">
              <ImageIcon class="w-8 h-8 mx-auto mb-2 opacity-50" />
              <span class="text-xs">暂无首帧</span>
            </div>
          </div>
          <img
            v-else
            :src="firstFrameSrc"
            alt="首帧"
            class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition"
            @click="handlePreview('first')"
          >
        </div>
      </div>

      <!-- 箭头指示 -->
      <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:flex items-center justify-center z-10">
        <div class="w-10 h-10 rounded-full bg-background border shadow-sm flex items-center justify-center">
          <ArrowRight class="w-5 h-5 text-muted-foreground" />
        </div>
      </div>

      <!-- 尾帧 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between text-sm">
          <span class="text-muted-foreground">尾帧</span>
          <div class="flex space-x-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :disabled="!lastFrame"
              @click="handlePreview('last')"
            >
              <ZoomIn class="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              @click="emit('regenerateLast')"
            >
              <RefreshCw class="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <div class="aspect-video rounded-lg overflow-hidden bg-muted border">
          <div
            v-if="loading && !lastFrame"
            class="w-full h-full flex items-center justify-center"
          >
            <RefreshCw class="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
          <div
            v-else-if="!lastFrame"
            class="w-full h-full flex items-center justify-center"
          >
            <div class="text-center text-muted-foreground">
              <ImageIcon class="w-8 h-8 mx-auto mb-2 opacity-50" />
              <span class="text-xs">暂无尾帧</span>
            </div>
          </div>
          <img
            v-else
            :src="lastFrameSrc"
            alt="尾帧"
            class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition"
            @click="handlePreview('last')"
          >
        </div>
      </div>
    </div>

    <!-- 提示信息 -->
    <p class="text-xs text-muted-foreground text-center">
      首帧和尾帧将用于生成场景过渡视频，确保两帧风格一致
    </p>
  </div>
</template>
