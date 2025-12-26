<script setup lang="ts">
import { Video, Loader2, Image, Check, AlertCircle, Sparkles, Play } from 'lucide-vue-next'
import type { SceneData, BatchStatus } from '~/composables/useWorkbench'

const props = defineProps<{
  scenes: SceneData[]
  selectedScene: SceneData | undefined
  batchFrameStatus: BatchStatus
  batchVideoStatus: BatchStatus
}>()

defineEmits<{
  selectScene: [scene: SceneData]
  generateFrames: [scene: SceneData]
  generateVideo: [scene: SceneData]
  batchGenerateFrames: []
  batchGenerateVideos: []
  previewImage: [src: string, alt: string]
}>()

const framesCompleted = computed(() => props.scenes.filter(s => s.frameStatus === 'done').length)
const videosCompleted = computed(() => props.scenes.filter(s => s.videoStatus === 'done').length)
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
      </div>
    </div>

    <div class="grid lg:grid-cols-3 gap-6">
      <!-- 场景列表 -->
      <div class="space-y-4">
        <h3 class="font-semibold">
          场景队列
        </h3>
        <div
          v-if="scenes.length === 0"
          class="text-center py-8 text-muted-foreground"
        >
          <Video class="w-8 h-8 mx-auto mb-2" />
          <p class="text-sm">
            请先解析剧本
          </p>
        </div>
        <div
          v-else
          class="space-y-2 max-h-[400px] overflow-y-auto"
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
      <div class="space-y-4">
        <h3 class="font-semibold">
          首尾帧预览
        </h3>
        <div
          v-if="selectedScene"
          class="space-y-4"
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
          class="text-center py-8 text-muted-foreground"
        >
          <p class="text-sm">
            请选择一个场景
          </p>
        </div>
      </div>

      <!-- 视频预览 -->
      <div class="space-y-4">
        <h3 class="font-semibold">
          视频预览
        </h3>
        <div
          v-if="selectedScene"
          class="space-y-4"
        >
          <div class="aspect-video bg-gray-900 rounded-lg flex items-center justify-center overflow-hidden">
            <video
              v-if="selectedScene.videoUrl"
              :src="selectedScene.videoUrl"
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
            {{ selectedScene.videoUrl ? '重新生成视频' : '生成视频' }}
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
  </div>
</template>
