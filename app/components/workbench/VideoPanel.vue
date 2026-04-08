<script setup lang="ts">
import { Video, Loader2, Image, Check, AlertCircle, Sparkles, Play, Film, Download } from 'lucide-vue-next'
import type { SceneData, BatchStatus } from '~/composables/useWorkbench'

const props = defineProps<{
  scenes: SceneData[]
  selectedScene: SceneData | undefined
  batchFrameStatus: BatchStatus
  batchVideoStatus: BatchStatus
  mergeStatus?: { running: boolean, progress: number, error?: string }
  finalVideo?: { videoData?: string, duration?: number, size?: number } | null
}>()

defineEmits<{
  selectScene: [scene: SceneData]
  generateFrames: [scene: SceneData]
  generateVideo: [scene: SceneData]
  batchGenerateFrames: []
  batchGenerateVideos: []
  mergeAllVideos: []
  previewImage: [src: string, alt: string]
}>()

const framesCompleted = computed(() => props.scenes.filter(s => s.frameStatus === 'done').length)
const videosCompleted = computed(() => props.scenes.filter(s => s.videoStatus === 'done').length)
const selectedScenePreviewUrl = computed(() => {
  const url = props.selectedScene?.videoUrl
  if (!url) return ''

  if (url.startsWith('/videos/')) {
    const filename = url.slice('/videos/'.length)
    return filename ? `/api/video/file/${filename}` : url
  }

  return url
})

// 下载最终视频
function downloadFinalVideo() {
  if (!props.finalVideo?.videoData) return

  const link = document.createElement('a')
  link.href = props.finalVideo.videoData
  link.download = `final_video_${Date.now()}.mp4`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="space-y-6">
    <!-- 批量操作栏 -->
    <div
      v-if="scenes.length > 0"
      class="flex items-center justify-between p-4 bg-accent rounded-lg"
    >
      <div class="flex items-center space-x-4">
        <div class="text-sm">
          <span class="font-medium">{{ scenes.length }}</span> 个场景
          <span class="text-muted-foreground mx-2">·</span>
          <span class="text-green-600">{{ framesCompleted }}</span> 首尾帧完成
          <span class="text-muted-foreground mx-2">·</span>
          <span class="text-blue-600">{{ videosCompleted }}</span> 视频完成
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="batchFrameStatus.running || batchVideoStatus.running"
          @click="$emit('batchGenerateFrames')"
        >
          <Loader2
            v-if="batchFrameStatus.running"
            class="w-4 h-4 mr-2 animate-spin"
          />
          <Image
            v-else
            class="w-4 h-4 mr-2"
          />
          {{ batchFrameStatus.running ? `生成中 (${batchFrameStatus.current}/${batchFrameStatus.total})` : '批量生成首尾帧' }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="batchFrameStatus.running || batchVideoStatus.running || framesCompleted === 0"
          @click="$emit('batchGenerateVideos')"
        >
          <Loader2
            v-if="batchVideoStatus.running"
            class="w-4 h-4 mr-2 animate-spin"
          />
          <Video
            v-else
            class="w-4 h-4 mr-2"
          />
          {{ batchVideoStatus.running ? `生成中 (${batchVideoStatus.current}/${batchVideoStatus.total})` : '批量生成视频' }}
        </Button>
        <Button
          size="sm"
          :disabled="batchFrameStatus.running || batchVideoStatus.running || mergeStatus?.running || videosCompleted < 2"
          @click="$emit('mergeAllVideos')"
        >
          <Loader2
            v-if="mergeStatus?.running"
            class="w-4 h-4 mr-2 animate-spin"
          />
          <Film
            v-else
            class="w-4 h-4 mr-2"
          />
          {{ mergeStatus?.running ? `合成中 ${mergeStatus.progress}%` : '合成最终视频' }}
        </Button>
      </div>
    </div>

    <div class="grid lg:grid-cols-3 gap-6 min-h-[500px]">
      <!-- 场景列表 -->
      <div class="flex flex-col">
        <h3 class="font-semibold mb-4">
          场景队列
        </h3>
        <div
          v-if="scenes.length === 0"
          class="flex-1 flex items-center justify-center text-muted-foreground border rounded-lg"
        >
          <div class="text-center">
            <Video class="w-8 h-8 mx-auto mb-2" />
            <p class="text-sm">
              请先解析剧本
            </p>
          </div>
        </div>
        <div
          v-else
          class="flex-1 space-y-2 overflow-y-auto"
        >
          <div
            v-for="(scene, idx) in scenes"
            :key="scene.id"
            class="p-3 border rounded-lg cursor-pointer transition"
            :class="scene.active ? 'border-primary bg-accent' : 'hover:border-primary/50'"
            @click="$emit('selectScene', scene)"
          >
            <div class="flex items-center justify-between">
              <span class="font-medium text-sm">场景 {{ idx + 1 }}</span>
              <div class="flex items-center space-x-1">
                <Check
                  v-if="scene.frameStatus === 'done'"
                  class="w-4 h-4 text-green-500"
                />
                <Loader2
                  v-else-if="scene.frameStatus === 'generating'"
                  class="w-4 h-4 animate-spin text-muted-foreground"
                />
                <AlertCircle
                  v-else-if="scene.frameStatus === 'error'"
                  class="w-4 h-4 text-red-500"
                />
                <div
                  v-else
                  class="w-4 h-4 rounded-full bg-muted"
                />
              </div>
            </div>
            <p class="text-xs text-muted-foreground mt-1 line-clamp-2">
              {{ scene.title }}
            </p>
          </div>
        </div>
      </div>

      <!-- 首尾帧预览 -->
      <div class="flex flex-col">
        <h3 class="font-semibold mb-4">
          首尾帧预览
        </h3>
        <div
          v-if="selectedScene"
          class="flex-1 flex flex-col space-y-4"
        >
          <div>
            <div class="text-xs text-muted-foreground mb-2">
              第一帧
            </div>
            <div class="aspect-video bg-muted rounded-lg flex items-center justify-center overflow-hidden">
              <img
                v-if="selectedScene.firstFrame"
                :src="`data:image/png;base64,${selectedScene.firstFrame}`"
                class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition"
                @click="$emit('previewImage', `data:image/png;base64,${selectedScene.firstFrame}`, `${selectedScene.title} - 第一帧`)"
              >
              <Image
                v-else
                class="w-8 h-8 text-muted-foreground"
              />
            </div>
          </div>
          <div>
            <div class="text-xs text-muted-foreground mb-2">
              最后一帧
            </div>
            <div class="aspect-video bg-muted rounded-lg flex items-center justify-center overflow-hidden">
              <img
                v-if="selectedScene.lastFrame"
                :src="`data:image/png;base64,${selectedScene.lastFrame}`"
                class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition"
                @click="$emit('previewImage', `data:image/png;base64,${selectedScene.lastFrame}`, `${selectedScene.title} - 最后一帧`)"
              >
              <Image
                v-else
                class="w-8 h-8 text-muted-foreground"
              />
            </div>
          </div>
          <Button
            variant="outline"
            class="w-full"
            :disabled="selectedScene.frameStatus === 'generating'"
            @click="$emit('generateFrames', selectedScene)"
          >
            <Loader2
              v-if="selectedScene.frameStatus === 'generating'"
              class="w-4 h-4 mr-2 animate-spin"
            />
            <Sparkles
              v-else
              class="w-4 h-4 mr-2"
            />
            {{ selectedScene.firstFrame ? '重新生成' : '生成首尾帧' }}
          </Button>
        </div>
        <div
          v-else
          class="flex-1 flex items-center justify-center text-muted-foreground border rounded-lg"
        >
          <p class="text-sm">
            请选择一个场景
          </p>
        </div>
      </div>

      <!-- 视频预览 -->
      <div class="flex flex-col">
        <h3 class="font-semibold mb-4">
          视频预览
        </h3>
        <div
          v-if="selectedScene"
          class="flex-1 flex flex-col space-y-4"
        >
          <div class="aspect-video bg-gray-900 rounded-lg flex items-center justify-center overflow-hidden">
            <video
              v-if="selectedScenePreviewUrl"
              :src="selectedScenePreviewUrl"
              controls
              class="w-full h-full"
            />
            <div
              v-else
              class="text-center text-gray-400"
            >
              <Play class="w-12 h-12 mx-auto mb-2" />
              <p class="text-sm">
                等待视频生成
              </p>
            </div>
          </div>
          <Button
            class="w-full"
            :disabled="selectedScene.videoStatus === 'generating' || selectedScene.frameStatus !== 'done'"
            @click="$emit('generateVideo', selectedScene)"
          >
            <Loader2
              v-if="selectedScene.videoStatus === 'generating'"
              class="w-4 h-4 mr-2 animate-spin"
            />
            <Play
              v-else
              class="w-4 h-4 mr-2"
            />
            {{ selectedScenePreviewUrl ? '重新生成视频' : '生成视频' }}
          </Button>
          <p
            v-if="selectedScene.frameStatus !== 'done'"
            class="text-xs text-muted-foreground text-center"
          >
            请先生成首尾帧
          </p>
        </div>
      </div>
    </div>

    <!-- 最终视频预览 -->
    <div
      v-if="finalVideo?.videoData || mergeStatus?.running || mergeStatus?.error"
      class="mt-6 p-4 border rounded-lg bg-accent/50"
    >
      <h3 class="font-semibold mb-4 flex items-center">
        <Film class="w-5 h-5 mr-2" />
        最终合成视频
      </h3>

      <!-- 合成进度 -->
      <div
        v-if="mergeStatus?.running"
        class="space-y-2"
      >
        <div class="flex items-center justify-between text-sm">
          <span>正在合成视频...</span>
          <span class="text-muted-foreground">{{ mergeStatus.progress }}%</span>
        </div>
        <div class="w-full bg-muted rounded-full h-2">
          <div
            class="bg-primary h-2 rounded-full transition-all duration-300"
            :style="{ width: `${mergeStatus.progress}%` }"
          />
        </div>
      </div>

      <!-- 合成错误 -->
      <div
        v-else-if="mergeStatus?.error"
        class="flex items-center space-x-2 text-destructive"
      >
        <AlertCircle class="w-5 h-5" />
        <span>合成失败: {{ mergeStatus.error }}</span>
      </div>

      <!-- 视频预览和下载 -->
      <div
        v-else-if="finalVideo?.videoData"
        class="space-y-4"
      >
        <div class="aspect-video bg-gray-900 rounded-lg overflow-hidden max-w-2xl mx-auto">
          <video
            :src="finalVideo.videoData"
            controls
            class="w-full h-full"
          />
        </div>
        <div class="flex items-center justify-between">
          <div class="text-sm text-muted-foreground">
            <span v-if="finalVideo.duration">时长: {{ finalVideo.duration.toFixed(1) }}秒</span>
            <span
              v-if="finalVideo.size"
              class="ml-4"
            >大小: {{ formatSize(finalVideo.size) }}</span>
          </div>
          <Button
            size="sm"
            @click="downloadFinalVideo"
          >
            <Download class="w-4 h-4 mr-2" />
            下载视频
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
