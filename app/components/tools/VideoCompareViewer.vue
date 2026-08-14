<script setup lang="ts">
import { Columns2, Loader2, Pause, Play, Sparkles, Video, Volume2, VolumeX } from 'lucide-vue-next'

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
  beforeLabel: '原视频',
  afterLabel: '增强后',
  emptyLabel: '暂无预览'
})

const mode = ref<CompareMode>('compare')
const beforeVideoRef = ref<HTMLVideoElement | null>(null)
const afterVideoRef = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
const startingPlayback = ref(false)
const muted = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const seekValue = ref([0])
let syncing = false
let playbackRequestId = 0

const cleanBeforeUrl = computed(() => props.beforeUrl.trim())
const cleanAfterUrl = computed(() => props.afterUrl.trim())
const hasBefore = computed(() => cleanBeforeUrl.value.length > 0)
const hasAfter = computed(() => cleanAfterUrl.value.length > 0)
const canCompare = computed(() => hasBefore.value && hasAfter.value)
const seekMax = computed(() => duration.value > 0 ? duration.value : 1)
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

watch(mode, () => {
  pauseCompareVideos()
})

watch([cleanBeforeUrl, cleanAfterUrl], () => {
  pauseCompareVideos()
  currentTime.value = 0
  seekValue.value = [0]
  duration.value = 0
})

function setMode(nextMode: CompareMode) {
  if (nextMode === 'compare' && !canCompare.value) return
  if (nextMode === 'before' && !hasBefore.value) return
  if (nextMode === 'after' && !hasAfter.value) return
  mode.value = nextMode
}

function getCompareVideos() {
  return [beforeVideoRef.value, afterVideoRef.value].filter(Boolean) as HTMLVideoElement[]
}

function updateDuration() {
  const durations = getCompareVideos()
    .map(videoElement => videoElement.duration)
    .filter(value => Number.isFinite(value) && value > 0)
  duration.value = durations.length ? Math.max(...durations) : 0
}

function setVideoTime(nextTime: number) {
  syncing = true
  for (const videoElement of getCompareVideos()) {
    const maxTime = Number.isFinite(videoElement.duration) && videoElement.duration > 0
      ? videoElement.duration
      : nextTime
    const clampedTime = Math.max(0, Math.min(nextTime, maxTime))
    if (Math.abs(videoElement.currentTime - clampedTime) > 0.05) {
      videoElement.currentTime = clampedTime
    }
  }
  window.setTimeout(() => {
    syncing = false
  }, 0)
}

function waitForPlayable(videoElement: HTMLVideoElement) {
  videoElement.preload = 'auto'
  if (videoElement.networkState === videoElement.NETWORK_EMPTY) {
    videoElement.load()
  }

  if (videoElement.readyState >= videoElement.HAVE_FUTURE_DATA) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    let settled = false
    let timeoutId: number | null = null

    const cleanup = () => {
      videoElement.removeEventListener('canplay', finish)
      videoElement.removeEventListener('error', finish)
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }

    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    videoElement.addEventListener('canplay', finish)
    videoElement.addEventListener('error', finish)
    timeoutId = window.setTimeout(finish, 5000)
  })
}

function handleTimeUpdate(source: HTMLVideoElement | null) {
  if (!source || syncing) return
  currentTime.value = source.currentTime
  seekValue.value = [source.currentTime]
  if (!playing.value) return
  for (const videoElement of getCompareVideos()) {
    if (videoElement === source) continue
    if (Math.abs(videoElement.currentTime - source.currentTime) > 0.35) {
      videoElement.currentTime = source.currentTime
    }
  }
}

function handleSeek(value?: number[]) {
  const nextTime = value?.[0] ?? 0
  currentTime.value = nextTime
  seekValue.value = [nextTime]
  setVideoTime(nextTime)
}

async function playCompareVideos() {
  const videos = getCompareVideos()
  if (videos.length === 0) return

  const requestId = ++playbackRequestId
  startingPlayback.value = true
  setVideoTime(currentTime.value)
  try {
    await Promise.all(videos.map(videoElement => waitForPlayable(videoElement)))
    if (requestId !== playbackRequestId) return
    setVideoTime(currentTime.value)
    await Promise.all(videos.map(videoElement => videoElement.play()))
    if (requestId !== playbackRequestId) return
    playing.value = true
  } catch {
    if (requestId === playbackRequestId) {
      playing.value = videos.some(videoElement => !videoElement.paused)
    }
  } finally {
    if (requestId === playbackRequestId) {
      startingPlayback.value = false
    }
  }
}

function pauseCompareVideos() {
  playbackRequestId += 1
  for (const videoElement of getCompareVideos()) {
    videoElement.pause()
  }
  startingPlayback.value = false
  playing.value = false
}

function togglePlayback() {
  if (playing.value || startingPlayback.value) {
    pauseCompareVideos()
    return
  }
  void playCompareVideos()
}

function handleEnded() {
  startingPlayback.value = false
  playing.value = false
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00'
  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

onUnmounted(() => {
  pauseCompareVideos()
})
</script>

<template>
  <div class="overflow-hidden rounded-xl bg-muted/25">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 p-2">
      <div class="flex items-center gap-2 text-sm font-medium text-foreground">
        <Columns2 class="h-4 w-4 text-primary" />
        对比预览
      </div>
      <div class="flex rounded-xl bg-muted/25 p-1">
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
          <Video class="mr-1.5 h-3.5 w-3.5" />
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
      class="grid gap-px bg-border lg:grid-cols-2"
    >
      <div class="bg-black">
        <div class="flex items-center justify-between bg-background px-3 py-2 text-xs font-medium text-foreground">
          <span>{{ beforeLabel }}</span>
          <span class="text-muted-foreground">静音</span>
        </div>
        <video
          ref="beforeVideoRef"
          :src="cleanBeforeUrl"
          muted
          playsinline
          preload="auto"
          class="aspect-video w-full bg-black object-contain"
          @loadedmetadata="updateDuration"
          @timeupdate="handleTimeUpdate(beforeVideoRef)"
          @ended="handleEnded"
        />
      </div>
      <div class="bg-black">
        <div class="flex items-center justify-between bg-background px-3 py-2 text-xs font-medium text-foreground">
          <span>{{ afterLabel }}</span>
          <button
            type="button"
            class="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            @click="muted = !muted"
          >
            <VolumeX v-if="muted" class="h-3.5 w-3.5" />
            <Volume2 v-else class="h-3.5 w-3.5" />
            {{ muted ? '静音' : '声音' }}
          </button>
        </div>
        <video
          ref="afterVideoRef"
          :src="cleanAfterUrl"
          :muted="muted"
          playsinline
          preload="auto"
          class="aspect-video w-full bg-black object-contain"
          @loadedmetadata="updateDuration"
          @timeupdate="handleTimeUpdate(afterVideoRef)"
          @ended="handleEnded"
        />
      </div>
    </div>

    <div
      v-else-if="activeSingleUrl"
      class="bg-black"
    >
      <video
        :src="activeSingleUrl"
        controls
        playsinline
        class="aspect-video w-full bg-black object-contain"
      />
      <div class="border-t bg-muted/20 px-3 py-2 text-xs font-medium text-foreground">
        {{ activeSingleLabel }}
      </div>
    </div>

    <div
      v-else
      class="flex aspect-video items-center justify-center bg-muted/20 text-sm text-muted-foreground"
    >
      {{ emptyLabel }}
    </div>

    <div
      v-if="mode === 'compare' && canCompare"
      class="space-y-3 border-t bg-muted/20 p-3"
    >
      <div class="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          class="h-9 w-9 p-0"
          @click="togglePlayback"
        >
          <Loader2 v-if="startingPlayback" class="h-4 w-4 animate-spin" />
          <Pause v-else-if="playing" class="h-4 w-4" />
          <Play v-else class="h-4 w-4" />
        </Button>
        <Slider
          v-model="seekValue"
          :min="0"
          :max="seekMax"
          :step="0.1"
          :disabled="duration <= 0"
          class="min-w-0 flex-1"
          @update:model-value="handleSeek"
        />
        <div class="w-24 text-right font-mono text-xs text-muted-foreground">
          {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
        </div>
      </div>
    </div>
    <div
      v-else-if="unavailableLabel"
      class="border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground"
    >
      {{ unavailableLabel }}
    </div>
  </div>
</template>
