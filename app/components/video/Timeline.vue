<script setup lang="ts">
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  GripVertical,
  Film,
  Music,
  MessageSquare
} from 'lucide-vue-next'

interface TimelineScene {
  id: string
  title: string
  duration: number
  startTime: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  thumbnail?: string
}

interface TimelineProps {
  scenes: TimelineScene[]
  currentTime?: number
  totalDuration?: number
  playing?: boolean
  zoom?: number
}

const props = withDefaults(defineProps<TimelineProps>(), {
  currentTime: 0,
  totalDuration: 0,
  playing: false,
  zoom: 1
})

const emit = defineEmits<{
  'update:currentTime': [time: number]
  'update:playing': [playing: boolean]
  'scene-click': [scene: TimelineScene]
  'scene-reorder': [fromIndex: number, toIndex: number]
}>()

const timelineRef = ref<HTMLElement | null>(null)
const localZoom = ref(props.zoom)

// 计算总时长
const computedTotalDuration = computed(() => {
  if (props.totalDuration > 0) return props.totalDuration
  return props.scenes.reduce((sum, s) => sum + s.duration, 0)
})

// 像素/秒比例
const pixelsPerSecond = computed(() => 50 * localZoom.value)

// 时间轴宽度
const timelineWidth = computed(() => computedTotalDuration.value * pixelsPerSecond.value)

// 播放头位置
const playheadPosition = computed(() => props.currentTime * pixelsPerSecond.value)

// 格式化时间
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// 生成时间刻度
const timeMarkers = computed(() => {
  const markers: { time: number, label: string, major: boolean }[] = []
  const interval = localZoom.value >= 1.5 ? 5 : localZoom.value >= 0.8 ? 10 : 30

  for (let t = 0; t <= computedTotalDuration.value; t += interval) {
    markers.push({
      time: t,
      label: formatTime(t),
      major: t % (interval * 2) === 0
    })
  }
  return markers
})

// 点击时间轴跳转
function handleTimelineClick(event: MouseEvent) {
  if (!timelineRef.value) return
  const rect = timelineRef.value.getBoundingClientRect()
  const x = event.clientX - rect.left + timelineRef.value.scrollLeft
  const time = Math.max(0, Math.min(computedTotalDuration.value, x / pixelsPerSecond.value))
  emit('update:currentTime', time)
}

// 缩放控制
function zoomIn() {
  localZoom.value = Math.min(3, localZoom.value + 0.25)
}

function zoomOut() {
  localZoom.value = Math.max(0.25, localZoom.value - 0.25)
}

// 状态颜色
function getStatusColor(status: TimelineScene['status']): string {
  switch (status) {
    case 'completed': return 'bg-green-500'
    case 'processing': return 'bg-blue-500'
    case 'failed': return 'bg-red-500'
    default: return 'bg-muted-foreground'
  }
}
</script>

<template>
  <div class="border rounded-xl overflow-hidden bg-background">
    <!-- 工具栏 -->
    <div class="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
      <div class="flex items-center space-x-2">
        <!-- 播放控制 -->
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          @click="emit('update:currentTime', 0)"
        >
          <SkipBack class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          @click="emit('update:playing', !playing)"
        >
          <Pause
            v-if="playing"
            class="w-4 h-4"
          />
          <Play
            v-else
            class="w-4 h-4"
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          @click="emit('update:currentTime', computedTotalDuration)"
        >
          <SkipForward class="w-4 h-4" />
        </Button>

        <!-- 当前时间 -->
        <div class="text-sm font-mono text-muted-foreground ml-2">
          {{ formatTime(currentTime) }} / {{ formatTime(computedTotalDuration) }}
        </div>
      </div>

      <div class="flex items-center space-x-2">
        <!-- 缩放控制 -->
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          @click="zoomOut"
        >
          <ZoomOut class="w-4 h-4" />
        </Button>
        <span class="text-xs text-muted-foreground w-12 text-center">
          {{ (localZoom * 100).toFixed(0) }}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          @click="zoomIn"
        >
          <ZoomIn class="w-4 h-4" />
        </Button>
      </div>
    </div>

    <!-- 时间轴主体 -->
    <div
      ref="timelineRef"
      class="overflow-x-auto"
    >
      <div
        class="relative min-h-[200px]"
        :style="{ width: `${Math.max(timelineWidth, 800)}px` }"
        @click="handleTimelineClick"
      >
        <!-- 时间刻度 -->
        <div class="h-6 border-b bg-muted/20 relative">
          <div
            v-for="marker in timeMarkers"
            :key="marker.time"
            class="absolute top-0 flex flex-col items-center"
            :style="{ left: `${marker.time * pixelsPerSecond}px` }"
          >
            <div
              class="w-px bg-border"
              :class="marker.major ? 'h-4' : 'h-2'"
            />
            <span
              v-if="marker.major"
              class="text-xs text-muted-foreground mt-0.5"
            >
              {{ marker.label }}
            </span>
          </div>
        </div>

        <!-- 视频轨道 -->
        <div class="h-16 border-b relative bg-muted/10">
          <div class="absolute left-0 top-0 h-full w-16 bg-muted/30 flex items-center justify-center border-r">
            <Film class="w-4 h-4 text-muted-foreground" />
          </div>
          <div class="ml-16 h-full relative">
            <div
              v-for="scene in scenes"
              :key="scene.id"
              class="absolute top-1 bottom-1 rounded cursor-pointer hover:opacity-80 transition group"
              :class="getStatusColor(scene.status)"
              :style="{
                left: `${scene.startTime * pixelsPerSecond}px`,
                width: `${Math.max(scene.duration * pixelsPerSecond - 4, 20)}px`
              }"
              @click.stop="emit('scene-click', scene)"
            >
              <!-- 缩略图 -->
              <div
                v-if="scene.thumbnail"
                class="absolute inset-0.5 rounded overflow-hidden"
              >
                <img
                  :src="scene.thumbnail"
                  :alt="scene.title"
                  class="w-full h-full object-cover"
                >
              </div>

              <!-- 标题 -->
              <div class="absolute bottom-0.5 left-1 right-1 text-xs text-white truncate drop-shadow">
                {{ scene.title }}
              </div>

              <!-- 拖拽手柄 -->
              <div class="absolute left-0 top-0 bottom-0 w-4 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-grab">
                <GripVertical class="w-3 h-3 text-white" />
              </div>
            </div>
          </div>
        </div>

        <!-- 音频轨道 -->
        <div class="h-12 border-b relative bg-muted/10">
          <div class="absolute left-0 top-0 h-full w-16 bg-muted/30 flex items-center justify-center border-r">
            <Music class="w-4 h-4 text-muted-foreground" />
          </div>
          <div class="ml-16 h-full flex items-center text-xs text-muted-foreground pl-4">
            音频轨道
          </div>
        </div>

        <!-- 字幕轨道 -->
        <div class="h-12 relative bg-muted/10">
          <div class="absolute left-0 top-0 h-full w-16 bg-muted/30 flex items-center justify-center border-r">
            <MessageSquare class="w-4 h-4 text-muted-foreground" />
          </div>
          <div class="ml-16 h-full flex items-center text-xs text-muted-foreground pl-4">
            字幕轨道
          </div>
        </div>

        <!-- 播放头 -->
        <div
          class="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
          :style="{ left: `${playheadPosition + 64}px` }"
        >
          <div class="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
        </div>
      </div>
    </div>
  </div>
</template>
