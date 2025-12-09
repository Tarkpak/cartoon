<script setup lang="ts">
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  SkipBack,
  SkipForward,
  Download,
  RefreshCw
} from 'lucide-vue-next'

interface VideoPreviewProps {
  src?: string
  poster?: string
  title?: string
  duration?: number
  loading?: boolean
  error?: string
}

const props = withDefaults(defineProps<VideoPreviewProps>(), {
  title: '视频预览',
  duration: 0,
  loading: false
})

const emit = defineEmits<{
  download: []
  regenerate: []
}>()

const videoRef = ref<HTMLVideoElement | null>(null)
const isPlaying = ref(false)
const isMuted = ref(false)
const currentTime = ref(0)
const videoDuration = ref(props.duration)
const showControls = ref(true)

// 格式化时间
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// 播放/暂停
function togglePlay() {
  if (!videoRef.value) return
  if (isPlaying.value) {
    videoRef.value.pause()
  } else {
    videoRef.value.play()
  }
}

// 静音切换
function toggleMute() {
  if (!videoRef.value) return
  videoRef.value.muted = !videoRef.value.muted
  isMuted.value = videoRef.value.muted
}

// 全屏
function toggleFullscreen() {
  if (!videoRef.value) return
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    videoRef.value.requestFullscreen()
  }
}

// 跳转
function seek(seconds: number) {
  if (!videoRef.value) return
  videoRef.value.currentTime = Math.max(0, Math.min(videoRef.value.duration, videoRef.value.currentTime + seconds))
}

// 进度条点击
function seekTo(event: MouseEvent) {
  if (!videoRef.value) return
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const percent = (event.clientX - rect.left) / rect.width
  videoRef.value.currentTime = percent * videoRef.value.duration
}

// 视频事件处理
function onPlay() {
  isPlaying.value = true
}

function onPause() {
  isPlaying.value = false
}

function onTimeUpdate() {
  if (!videoRef.value) return
  currentTime.value = videoRef.value.currentTime
}

function onLoadedMetadata() {
  if (!videoRef.value) return
  videoDuration.value = videoRef.value.duration
}

// 进度百分比
const progressPercent = computed(() => {
  if (videoDuration.value === 0) return 0
  return (currentTime.value / videoDuration.value) * 100
})
</script>

<template>
  <div
    class="relative rounded-xl overflow-hidden bg-black group"
    @mouseenter="showControls = true"
    @mouseleave="showControls = !isPlaying"
  >
    <!-- 加载状态 -->
    <div
      v-if="loading"
      class="aspect-video flex items-center justify-center"
    >
      <div class="text-center">
        <RefreshCw class="w-12 h-12 mx-auto mb-3 animate-spin text-primary" />
        <p class="text-muted-foreground">
          视频生成中...
        </p>
      </div>
    </div>

    <!-- 错误状态 -->
    <div
      v-else-if="error"
      class="aspect-video flex items-center justify-center bg-red-950/20"
    >
      <div class="text-center">
        <p class="text-red-400 mb-3">
          {{ error }}
        </p>
        <Button
          variant="outline"
          @click="emit('regenerate')"
        >
          <RefreshCw class="w-4 h-4 mr-2" />
          重新生成
        </Button>
      </div>
    </div>

    <!-- 无视频 -->
    <div
      v-else-if="!src"
      class="aspect-video flex items-center justify-center bg-muted"
    >
      <div class="text-center text-muted-foreground">
        <Play class="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>暂无视频</p>
      </div>
    </div>

    <!-- 视频播放器 -->
    <template v-else>
      <video
        ref="videoRef"
        :src="src"
        :poster="poster"
        class="w-full aspect-video object-contain"
        @play="onPlay"
        @pause="onPause"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onLoadedMetadata"
        @click="togglePlay"
      />

      <!-- 控制栏 -->
      <div
        class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 transition-opacity duration-300"
        :class="showControls ? 'opacity-100' : 'opacity-0'"
      >
        <!-- 进度条 -->
        <div
          class="h-1 bg-white/20 rounded-full mb-3 cursor-pointer group/progress"
          @click="seekTo"
        >
          <div
            class="h-full bg-primary rounded-full relative"
            :style="{ width: `${progressPercent}%` }"
          >
            <div class="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full opacity-0 group-hover/progress:opacity-100 transition" />
          </div>
        </div>

        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <!-- 播放/暂停 -->
            <Button
              variant="ghost"
              size="icon"
              class="text-white hover:text-white hover:bg-white/20"
              @click="togglePlay"
            >
              <Pause
                v-if="isPlaying"
                class="w-5 h-5"
              />
              <Play
                v-else
                class="w-5 h-5"
              />
            </Button>

            <!-- 后退/前进 -->
            <Button
              variant="ghost"
              size="icon"
              class="text-white hover:text-white hover:bg-white/20"
              @click="seek(-5)"
            >
              <SkipBack class="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="text-white hover:text-white hover:bg-white/20"
              @click="seek(5)"
            >
              <SkipForward class="w-4 h-4" />
            </Button>

            <!-- 时间显示 -->
            <span class="text-white text-sm">
              {{ formatTime(currentTime) }} / {{ formatTime(videoDuration) }}
            </span>
          </div>

          <div class="flex items-center space-x-2">
            <!-- 静音 -->
            <Button
              variant="ghost"
              size="icon"
              class="text-white hover:text-white hover:bg-white/20"
              @click="toggleMute"
            >
              <VolumeX
                v-if="isMuted"
                class="w-5 h-5"
              />
              <Volume2
                v-else
                class="w-5 h-5"
              />
            </Button>

            <!-- 下载 -->
            <Button
              variant="ghost"
              size="icon"
              class="text-white hover:text-white hover:bg-white/20"
              @click="emit('download')"
            >
              <Download class="w-5 h-5" />
            </Button>

            <!-- 全屏 -->
            <Button
              variant="ghost"
              size="icon"
              class="text-white hover:text-white hover:bg-white/20"
              @click="toggleFullscreen"
            >
              <Maximize class="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      <!-- 大播放按钮（暂停时显示） -->
      <div
        v-if="!isPlaying"
        class="absolute inset-0 flex items-center justify-center cursor-pointer"
        @click="togglePlay"
      >
        <div class="w-16 h-16 rounded-full bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white/30 transition">
          <Play class="w-8 h-8 text-white ml-1" />
        </div>
      </div>
    </template>

    <!-- 标题 -->
    <div
      v-if="title && showControls"
      class="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 to-transparent p-4"
    >
      <h3 class="text-white font-medium">
        {{ title }}
      </h3>
    </div>
  </div>
</template>
