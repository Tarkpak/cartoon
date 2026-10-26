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

interface TimelineAudioTrack {
  id: string
  name: string
  kind: 'bgm' | 'sfx'
  startTime: number
  duration?: number
}

interface TimelineProps {
  scenes: TimelineScene[]
  currentTime?: number
  totalDuration?: number
  playing?: boolean
  zoom?: number
  audioTracks?: TimelineAudioTrack[]
  /** Undefined hides the subtitle row's state text. */
  subtitlesEnabled?: boolean
  /** Lets clips be dragged (or moved with Alt + arrow keys) to reorder. */
  reorderable?: boolean
}

const props = withDefaults(defineProps<TimelineProps>(), {
  currentTime: 0,
  totalDuration: 0,
  playing: false,
  zoom: 1,
  audioTracks: () => [],
  subtitlesEnabled: undefined,
  reorderable: false
})

const emit = defineEmits<{
  'update:currentTime': [time: number]
  'update:playing': [playing: boolean]
  'scene-click': [scene: TimelineScene]
  'scene-reorder': [fromIndex: number, toIndex: number]
}>()

// Width of the track label column on the left of every row.
const TRACK_LABEL_WIDTH = 64

const timelineRef = ref<HTMLElement | null>(null)
const localZoom = ref(props.zoom)

const computedTotalDuration = computed(() => {
  if (props.totalDuration > 0) return props.totalDuration
  return props.scenes.reduce((sum, s) => sum + s.duration, 0)
})

const pixelsPerSecond = computed(() => 50 * localZoom.value)
const timelineWidth = computed(() => computedTotalDuration.value * pixelsPerSecond.value)
const playheadPosition = computed(() => props.currentTime * pixelsPerSecond.value)

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

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

function handleTimelineClick(event: MouseEvent) {
  if (!timelineRef.value) return
  const rect = timelineRef.value.getBoundingClientRect()
  const x = event.clientX - rect.left + timelineRef.value.scrollLeft - TRACK_LABEL_WIDTH
  const time = Math.max(0, Math.min(computedTotalDuration.value, x / pixelsPerSecond.value))
  emit('update:currentTime', time)
}

function zoomIn() {
  localZoom.value = Math.min(3, localZoom.value + 0.25)
}

function zoomOut() {
  localZoom.value = Math.max(0.25, localZoom.value - 0.25)
}

function getStatusColor(status: TimelineScene['status']): string {
  switch (status) {
    case 'completed': return 'bg-primary/80'
    case 'processing': return 'bg-primary/40'
    case 'failed': return 'bg-destructive/80'
    default: return 'bg-muted-foreground'
  }
}

// ---- Reordering ----
const draggingIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function handleDragStart(event: DragEvent, index: number) {
  if (!props.reorderable) return
  draggingIndex.value = index
  event.dataTransfer?.setData('text/plain', String(index))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function handleDragOver(index: number) {
  if (draggingIndex.value === null) return
  dropIndex.value = index
}

function handleDrop(index: number) {
  const from = draggingIndex.value
  draggingIndex.value = null
  dropIndex.value = null
  if (from === null || from === index) return
  emit('scene-reorder', from, index)
}

function handleDragEnd() {
  draggingIndex.value = null
  dropIndex.value = null
}

function handleClipKeydown(event: KeyboardEvent, index: number) {
  if (!props.reorderable || !event.altKey) return
  const target = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : -1
  if (target < 0 || target >= props.scenes.length) return
  event.preventDefault()
  emit('scene-reorder', index, target)
}

function audioTrackStyle(track: TimelineAudioTrack) {
  const total = Math.max(0.5, computedTotalDuration.value)
  const start = Math.max(0, Math.min(total, track.startTime))
  const duration = track.kind === 'bgm' ? total - start : Math.max(0.1, track.duration || 1)
  return {
    left: `${start * pixelsPerSecond.value}px`,
    width: `${Math.max(8, Math.min(total - start, duration) * pixelsPerSecond.value - 2)}px`
  }
}

const bgmTracks = computed(() => props.audioTracks.filter(track => track.kind === 'bgm'))
const sfxTracks = computed(() => props.audioTracks.filter(track => track.kind === 'sfx'))
</script>

<template>
  <div class="border rounded-xl overflow-hidden bg-background">
    <!-- 工具栏: playback and zoom never change the project, so read-only viewers keep them -->
    <div
      class="flex items-center justify-between px-4 py-2 border-b bg-muted/30"
      data-readonly-allowed
    >
      <div class="flex items-center gap-1">
        <IconActionButton
          label="回到开头"
          @click="emit('update:currentTime', 0)"
        >
          <SkipBack class="w-4 h-4" />
        </IconActionButton>
        <IconActionButton
          :label="playing ? '暂停' : '播放'"
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
        </IconActionButton>
        <IconActionButton
          label="跳到结尾"
          @click="emit('update:currentTime', computedTotalDuration)"
        >
          <SkipForward class="w-4 h-4" />
        </IconActionButton>

        <div class="text-sm font-mono tabular-nums text-muted-foreground ml-2">
          {{ formatTime(currentTime) }} / {{ formatTime(computedTotalDuration) }}
        </div>
      </div>

      <div class="flex items-center gap-1">
        <span
          v-if="reorderable && scenes.length > 1"
          class="mr-2 hidden text-xs text-muted-foreground sm:inline"
        >
          拖动片段可调整顺序
        </span>
        <IconActionButton
          label="缩小"
          @click="zoomOut"
        >
          <ZoomOut class="w-4 h-4" />
        </IconActionButton>
        <span class="text-xs tabular-nums text-muted-foreground w-12 text-center">
          {{ (localZoom * 100).toFixed(0) }}%
        </span>
        <IconActionButton
          label="放大"
          @click="zoomIn"
        >
          <ZoomIn class="w-4 h-4" />
        </IconActionButton>
      </div>
    </div>

    <!-- 时间轴主体 -->
    <div
      ref="timelineRef"
      class="overflow-x-auto"
    >
      <div
        class="relative"
        :style="{ width: `${Math.max(timelineWidth + TRACK_LABEL_WIDTH, 800)}px` }"
        @click="handleTimelineClick"
      >
        <!-- 时间刻度 -->
        <div class="h-6 border-b bg-muted/20 relative ml-16">
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
          <div
            class="absolute left-0 top-0 h-full w-16 bg-muted/30 flex items-center justify-center border-r"
            title="视频"
          >
            <Film class="w-4 h-4 text-muted-foreground" />
          </div>
          <div class="ml-16 h-full relative">
            <div
              v-for="(scene, index) in scenes"
              :key="scene.id"
              class="absolute top-1 bottom-1 overflow-hidden rounded transition group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="[
                getStatusColor(scene.status),
                reorderable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                draggingIndex === index ? 'opacity-40' : 'hover:opacity-90',
                dropIndex === index && draggingIndex !== index ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
              ]"
              :style="{
                left: `${scene.startTime * pixelsPerSecond}px`,
                width: `${Math.max(scene.duration * pixelsPerSecond - 4, 20)}px`
              }"
              :draggable="reorderable"
              :tabindex="reorderable ? 0 : undefined"
              :aria-label="reorderable ? `${index + 1}. ${scene.title}，按 Alt + 左右方向键调整顺序` : scene.title"
              :title="scene.title"
              @click.stop="emit('scene-click', scene)"
              @dragstart="handleDragStart($event, index)"
              @dragover.prevent="handleDragOver(index)"
              @drop.prevent="handleDrop(index)"
              @dragend="handleDragEnd"
              @keydown="handleClipKeydown($event, index)"
            >
              <img
                v-if="scene.thumbnail"
                :src="scene.thumbnail"
                :alt="scene.title"
                class="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-80"
                draggable="false"
              >
              <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1 pb-0.5 pt-3 text-xs text-white truncate">
                {{ index + 1 }} · {{ scene.title }}
              </div>
              <div
                v-if="reorderable"
                class="absolute left-0 top-0 bottom-0 w-4 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100"
                aria-hidden="true"
              >
                <GripVertical class="w-3 h-3 text-white" />
              </div>
            </div>
          </div>
        </div>

        <!-- 音频轨道 -->
        <div class="min-h-12 border-b relative bg-muted/10">
          <div
            class="absolute left-0 top-0 h-full w-16 bg-muted/30 flex items-center justify-center border-r"
            title="音频"
          >
            <Music class="w-4 h-4 text-muted-foreground" />
          </div>
          <div
            v-if="audioTracks.length === 0"
            class="ml-16 flex h-12 items-center pl-4 text-xs text-muted-foreground"
          >
            暂无 BGM 或音效
          </div>
          <div
            v-else
            class="ml-16 space-y-1 py-1.5"
          >
            <div
              v-for="group in [bgmTracks, sfxTracks].filter(tracks => tracks.length > 0)"
              :key="group[0]!.kind"
              class="relative h-5"
            >
              <div
                v-for="track in group"
                :key="track.id"
                class="absolute inset-y-0 truncate rounded px-1.5 text-[11px] leading-5"
                :class="track.kind === 'bgm' ? 'bg-primary/25 text-foreground' : 'bg-warning/25 text-foreground'"
                :style="audioTrackStyle(track)"
                :title="`${track.kind === 'bgm' ? 'BGM' : '音效'}：${track.name}`"
              >
                {{ track.name }}
              </div>
            </div>
          </div>
        </div>

        <!-- 字幕轨道 -->
        <div class="h-10 relative bg-muted/10">
          <div
            class="absolute left-0 top-0 h-full w-16 bg-muted/30 flex items-center justify-center border-r"
            title="字幕"
          >
            <MessageSquare class="w-4 h-4 text-muted-foreground" />
          </div>
          <div class="ml-16 h-full relative">
            <div
              v-if="subtitlesEnabled"
              class="absolute inset-y-2 left-0 rounded bg-muted px-1.5 text-[11px] leading-6 text-muted-foreground"
              :style="{ width: `${Math.max(timelineWidth - 2, 40)}px` }"
            >
              合成时叠加字幕
            </div>
            <div
              v-else-if="subtitlesEnabled === false"
              class="flex h-full items-center pl-4 text-xs text-muted-foreground"
            >
              未开启字幕叠加
            </div>
          </div>
        </div>

        <!-- 播放头 -->
        <div
          class="absolute top-0 bottom-0 w-0.5 bg-destructive z-10 pointer-events-none"
          :style="{ left: `${playheadPosition + TRACK_LABEL_WIDTH}px` }"
        >
          <div class="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-destructive rounded-full" />
        </div>
      </div>
    </div>
  </div>
</template>
