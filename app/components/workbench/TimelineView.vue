<script setup lang="ts">
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Maximize2,
  Minimize2,
  Clock,
  Camera,
  Move,
  Layers,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle
} from 'lucide-vue-next'
import type { SceneData } from '~/composables/useWorkbench'

const props = defineProps<{
  scenes: SceneData[]
  selectedSceneId?: string
}>()

const emit = defineEmits<{
  'select-scene': [scene: SceneData]
  'edit-scene': [scene: SceneData]
}>()

// 时间线状态
const isExpanded = ref(false)
const currentTime = ref(0)
const isPlaying = ref(false)
const playInterval = ref<ReturnType<typeof setInterval> | null>(null)

// 计算总时长
const totalDuration = computed(() => {
  return props.scenes.reduce((sum, scene) => {
    const transitionDuration = scene.transitionDuration || 0.5
    return sum + scene.duration + transitionDuration
  }, 0)
})

// 格式化时间
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`
}

// 计算场景在时间线上的位置和宽度
function getSceneStyle(sceneIndex: number) {
  let startTime = 0
  for (let i = 0; i < sceneIndex; i++) {
    const scene = props.scenes[i]
    if (scene) {
      startTime += scene.duration + (scene.transitionDuration || 0.5)
    }
  }
  
  const scene = props.scenes[sceneIndex]
  if (!scene) return { left: '0%', width: '0%' }
  
  const duration = scene.duration
  const leftPercent = (startTime / totalDuration.value) * 100
  const widthPercent = (duration / totalDuration.value) * 100
  
  return {
    left: `${leftPercent}%`,
    width: `${widthPercent}%`
  }
}

// 计算转场在时间线上的位置
function getTransitionStyle(sceneIndex: number) {
  let startTime = 0
  for (let i = 0; i <= sceneIndex; i++) {
    const scene = props.scenes[i]
    if (scene) {
      startTime += scene.duration
      if (i < sceneIndex) {
        startTime += scene.transitionDuration || 0.5
      }
    }
  }
  
  const scene = props.scenes[sceneIndex]
  if (!scene) return { left: '0%', width: '0%' }
  
  const transitionDuration = scene.transitionDuration || 0.5
  const leftPercent = (startTime / totalDuration.value) * 100
  const widthPercent = (transitionDuration / totalDuration.value) * 100
  
  return {
    left: `${leftPercent}%`,
    width: `${widthPercent}%`
  }
}

// 获取当前时间对应的场景
function getCurrentScene(): SceneData | null {
  let accumulatedTime = 0
  for (const scene of props.scenes) {
    accumulatedTime += scene.duration + (scene.transitionDuration || 0.5)
    if (currentTime.value < accumulatedTime) {
      return scene
    }
  }
  return props.scenes[props.scenes.length - 1] || null
}

// 播放控制
function togglePlay() {
  if (isPlaying.value) {
    pause()
  } else {
    play()
  }
}

function play() {
  if (currentTime.value >= totalDuration.value) {
    currentTime.value = 0
  }
  isPlaying.value = true
  playInterval.value = setInterval(() => {
    currentTime.value += 0.1
    if (currentTime.value >= totalDuration.value) {
      pause()
      currentTime.value = totalDuration.value
    }
  }, 100)
}

function pause() {
  isPlaying.value = false
  if (playInterval.value) {
    clearInterval(playInterval.value)
    playInterval.value = null
  }
}

function skipToStart() {
  currentTime.value = 0
  pause()
}

function skipToEnd() {
  currentTime.value = totalDuration.value
  pause()
}

// 点击时间线跳转
function handleTimelineClick(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const clickX = event.clientX - rect.left
  const percent = clickX / rect.width
  currentTime.value = percent * totalDuration.value
}

// 景别标签
const shotTypeLabels: Record<string, string> = {
  extreme_wide: '大远景',
  wide: '全景',
  medium_wide: '中全景',
  medium: '中景',
  medium_close: '中近景',
  close: '近景',
  extreme_close: '特写',
  detail: '细节'
}

// 运镜标签
const cameraMovementLabels: Record<string, string> = {
  static: '定镜',
  push: '推',
  pull: '拉',
  pan_left: '左摇',
  pan_right: '右摇',
  tilt_up: '上摇',
  tilt_down: '下摇',
  track: '跟',
  dolly: '移',
  zoom_in: '变焦推',
  zoom_out: '变焦拉',
  crane: '升降',
  handheld: '手持',
  arc: '环绕'
}

// 转场标签
const transitionLabels: Record<string, string> = {
  cut: '硬切',
  fade: '淡变',
  dissolve: '叠化',
  wipe: '划变',
  slide: '滑动',
  zoom: '缩放',
  blur: '模糊',
  flash: '闪白',
  none: '无'
}

// 状态图标和颜色
function getStatusConfig(scene: SceneData) {
  if (scene.videoStatus === 'done') {
    return { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500' }
  }
  if (scene.videoStatus === 'generating' || scene.frameStatus === 'generating') {
    return { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-500', spin: true }
  }
  if (scene.videoStatus === 'error' || scene.frameStatus === 'error') {
    return { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500' }
  }
  if (scene.frameStatus === 'done') {
    return { icon: Circle, color: 'text-yellow-500', bg: 'bg-yellow-500' }
  }
  return { icon: Circle, color: 'text-muted-foreground', bg: 'bg-muted-foreground' }
}

// 清理
onUnmounted(() => {
  if (playInterval.value) {
    clearInterval(playInterval.value)
  }
})
</script>

<template>
  <div
    class="border rounded-lg bg-card transition-all duration-300"
    :class="isExpanded ? 'fixed inset-4 z-50 shadow-2xl' : ''"
  >
    <!-- 头部 -->
    <div class="flex items-center justify-between p-3 border-b">
      <div class="flex items-center space-x-4">
        <h3 class="font-semibold text-sm">
          时间线视图
        </h3>
        <div class="flex items-center space-x-2 text-sm text-muted-foreground">
          <Clock class="w-4 h-4" />
          <span>{{ formatTime(currentTime) }} / {{ formatTime(totalDuration) }}</span>
        </div>
        <Badge variant="outline">
          {{ scenes.length }} 场景
        </Badge>
      </div>
      
      <div class="flex items-center space-x-2">
        <!-- 播放控制 -->
        <div class="flex items-center space-x-1 mr-4">
          <Button
            variant="ghost"
            size="sm"
            class="h-8 w-8 p-0"
            @click="skipToStart"
          >
            <SkipBack class="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-8 w-8 p-0"
            @click="togglePlay"
          >
            <Pause
              v-if="isPlaying"
              class="w-4 h-4"
            />
            <Play
              v-else
              class="w-4 h-4"
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-8 w-8 p-0"
            @click="skipToEnd"
          >
            <SkipForward class="w-4 h-4" />
          </Button>
        </div>
        
        <!-- 展开/收起 -->
        <Button
          variant="ghost"
          size="sm"
          class="h-8 w-8 p-0"
          @click="isExpanded = !isExpanded"
        >
          <Minimize2
            v-if="isExpanded"
            class="w-4 h-4"
          />
          <Maximize2
            v-else
            class="w-4 h-4"
          />
        </Button>
      </div>
    </div>
    
    <!-- 时间线主体 -->
    <div
      class="p-4 overflow-x-auto"
      :class="isExpanded ? 'h-[calc(100%-60px)] overflow-y-auto' : ''"
    >
      <!-- 时间线内容容器 -->
      <div
        class="min-w-fit"
        :style="{ width: totalDuration > 60 ? `${Math.max(100, totalDuration * 15)}px` : '100%' }"
      >
        <!-- 时间刻度 -->
        <div class="relative h-6 mb-2">
          <div
            v-for="i in Math.ceil(totalDuration / 5) + 1"
            :key="i"
            class="absolute text-xs text-muted-foreground whitespace-nowrap"
            :style="{ left: `${((i - 1) * 5 / totalDuration) * 100}%` }"
          >
            {{ formatTime((i - 1) * 5) }}
          </div>
        </div>
      
      <!-- 时间线轨道 -->
      <div
        class="relative h-16 bg-muted/30 rounded-lg cursor-pointer"
        @click="handleTimelineClick"
      >
        <!-- 场景块 -->
        <div
          v-for="(scene, index) in scenes"
          :key="scene.id"
          class="absolute top-1 h-14 rounded-md cursor-pointer transition-all hover:ring-2 hover:ring-primary/50"
          :class="[
            selectedSceneId === scene.id ? 'ring-2 ring-primary' : '',
            scene.videoStatus === 'done' ? 'bg-green-100 dark:bg-green-900/30' :
            scene.frameStatus === 'done' ? 'bg-yellow-100 dark:bg-yellow-900/30' :
            'bg-blue-100 dark:bg-blue-900/30'
          ]"
          :style="getSceneStyle(index)"
          @click.stop="emit('select-scene', scene)"
          @dblclick.stop="emit('edit-scene', scene)"
        >
          <div class="p-1.5 h-full flex flex-col justify-between overflow-hidden">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium truncate">{{ index + 1 }}. {{ scene.title }}</span>
              <component
                :is="getStatusConfig(scene).icon"
                class="w-3 h-3 flex-shrink-0"
                :class="[getStatusConfig(scene).color, getStatusConfig(scene).spin ? 'animate-spin' : '']"
              />
            </div>
            <div class="flex items-center space-x-1">
              <Badge
                v-if="scene.shotType && scene.shotType !== 'medium'"
                variant="outline"
                class="text-[10px] px-1 py-0 h-4"
              >
                {{ shotTypeLabels[scene.shotType] || scene.shotType }}
              </Badge>
              <Badge
                v-if="scene.cameraMovement && scene.cameraMovement !== 'static'"
                variant="outline"
                class="text-[10px] px-1 py-0 h-4"
              >
                {{ cameraMovementLabels[scene.cameraMovement] || scene.cameraMovement }}
              </Badge>
              <span class="text-[10px] text-muted-foreground ml-auto">{{ scene.duration }}s</span>
            </div>
          </div>
        </div>
        
        <!-- 转场标记 -->
        <div
          v-for="(scene, index) in scenes.slice(0, -1)"
          :key="`transition-${scene.id}`"
          class="absolute top-1 h-14 flex items-center justify-center"
          :style="getTransitionStyle(index)"
        >
          <div
            class="w-full h-full bg-muted rounded flex items-center justify-center"
            :title="`转场: ${transitionLabels[scene.transitionOut || 'cut']}`"
          >
            <Layers class="w-3 h-3 text-muted-foreground" />
          </div>
        </div>
        
        <!-- 播放头 -->
        <div
          class="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
          :style="{ left: `${(currentTime / totalDuration) * 100}%` }"
        >
          <div class="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
        </div>
      </div>
      </div>

      <!-- 详细场景列表（展开模式） -->
      <div
        v-if="isExpanded"
        class="mt-6 space-y-2"
      >
        <div
          v-for="(scene, index) in scenes"
          :key="`detail-${scene.id}`"
          class="flex items-center space-x-4 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition"
          :class="selectedSceneId === scene.id ? 'bg-accent border-primary' : ''"
          @click="emit('select-scene', scene)"
          @dblclick="emit('edit-scene', scene)"
        >
          <!-- 序号和状态 -->
          <div class="flex items-center space-x-2 w-16">
            <Badge :variant="selectedSceneId === scene.id ? 'default' : 'secondary'">
              {{ index + 1 }}
            </Badge>
            <component
              :is="getStatusConfig(scene).icon"
              class="w-4 h-4"
              :class="[getStatusConfig(scene).color, getStatusConfig(scene).spin ? 'animate-spin' : '']"
            />
          </div>
          
          <!-- 缩略图 -->
          <div class="w-20 h-12 bg-muted rounded overflow-hidden flex-shrink-0">
            <img
              v-if="scene.firstFrame"
              :src="scene.firstFrame.startsWith('data:') ? scene.firstFrame : `data:image/png;base64,${scene.firstFrame}`"
              :alt="scene.title"
              class="w-full h-full object-cover"
            >
            <div
              v-else
              class="w-full h-full flex items-center justify-center text-muted-foreground"
            >
              <Camera class="w-4 h-4" />
            </div>
          </div>
          
          <!-- 场景信息 -->
          <div class="flex-1 min-w-0">
            <h4 class="font-medium truncate">
              {{ scene.title }}
            </h4>
            <p class="text-sm text-muted-foreground truncate">
              {{ scene.description }}
            </p>
          </div>
          
          <!-- 镜头语言 -->
          <div class="flex items-center space-x-2">
            <Badge
              v-if="scene.shotType"
              variant="outline"
              class="bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300"
            >
              <Camera class="w-3 h-3 mr-1" />
              {{ shotTypeLabels[scene.shotType] || scene.shotType }}
            </Badge>
            <Badge
              v-if="scene.cameraMovement && scene.cameraMovement !== 'static'"
              variant="outline"
              class="bg-green-50 border-green-200 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300"
            >
              <Move class="w-3 h-3 mr-1" />
              {{ cameraMovementLabels[scene.cameraMovement] || scene.cameraMovement }}
            </Badge>
          </div>
          
          <!-- 转场 -->
          <div class="flex items-center space-x-2">
            <Badge
              v-if="scene.transitionIn && scene.transitionIn !== 'cut'"
              variant="outline"
            >
              入: {{ transitionLabels[scene.transitionIn] || scene.transitionIn }}
            </Badge>
            <Badge
              v-if="scene.transitionOut && scene.transitionOut !== 'cut'"
              variant="outline"
            >
              出: {{ transitionLabels[scene.transitionOut] || scene.transitionOut }}
            </Badge>
          </div>
          
          <!-- 时长 -->
          <div class="w-16 text-right">
            <Badge variant="outline">
              <Clock class="w-3 h-3 mr-1" />
              {{ scene.duration }}s
            </Badge>
          </div>
        </div>
      </div>

      <!-- 图例 -->
      <div class="flex items-center justify-center space-x-6 mt-4 text-xs text-muted-foreground">
        <div class="flex items-center space-x-1">
          <div class="w-3 h-3 rounded bg-green-500" />
          <span>视频完成</span>
        </div>
        <div class="flex items-center space-x-1">
          <div class="w-3 h-3 rounded bg-yellow-500" />
          <span>帧完成</span>
        </div>
        <div class="flex items-center space-x-1">
          <div class="w-3 h-3 rounded bg-blue-500" />
          <span>生成中</span>
        </div>
        <div class="flex items-center space-x-1">
          <div class="w-3 h-3 rounded bg-muted-foreground" />
          <span>待处理</span>
        </div>
        <div class="flex items-center space-x-1">
          <div class="w-3 h-3 rounded bg-muted-foreground" />
          <span>转场</span>
        </div>
      </div>
    </div>
  </div>
</template>
