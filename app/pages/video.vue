<script setup lang="ts">
import { Settings, Play, Check, Loader2, Image, ArrowDown, PlayCircle } from 'lucide-vue-next'

// 视频生成页面
definePageMeta({
  layout: 'default'
})

interface SceneTask {
  id: string
  title: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
}

const scenes = ref<SceneTask[]>([])
const _loading = ref(false)

const duration = ref(8)
const resolution = ref('1080p')
const audioEnabled = ref(true)

const statusConfig: Record<string, { icon: typeof Check | typeof Loader2 | null, bg: string, spin?: boolean }> = {
  completed: { icon: Check, bg: 'bg-green-50 border-green-200' },
  processing: { icon: Loader2, bg: 'bg-purple-50 border-purple-200', spin: true },
  pending: { icon: null, bg: 'bg-muted' },
  failed: { icon: null, bg: 'bg-red-50 border-red-200' }
}
</script>

<template>
  <div class="p-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-2xl font-bold">
          视频生成
        </h1>
        <p class="text-muted-foreground">
          预览和生成场景视频
        </p>
      </div>
      <div class="flex space-x-3">
        <Button variant="outline">
          <Settings class="w-4 h-4 mr-2" />
          生成设置
        </Button>
        <Button>
          <Play class="w-4 h-4 mr-2" />
          批量生成
        </Button>
      </div>
    </div>

    <div class="grid lg:grid-cols-3 gap-6">
      <!-- 左侧: 场景列表 -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base">
            场景队列
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            <div
              v-for="scene in scenes"
              :key="scene.id"
              class="flex items-center space-x-3 p-3 rounded-xl border"
              :class="statusConfig[scene.status]?.bg"
            >
              <div
                class="w-8 h-8 rounded-lg flex items-center justify-center"
                :class="scene.status === 'completed' ? 'bg-green-500' : scene.status === 'processing' ? 'bg-purple-500' : 'bg-muted-foreground/30'"
              >
                <component
                  :is="statusConfig[scene.status]?.icon"
                  v-if="statusConfig[scene.status]?.icon"
                  class="w-4 h-4 text-white"
                  :class="{ 'animate-spin': statusConfig[scene.status]?.spin }"
                />
                <span
                  v-else
                  class="text-white text-sm font-medium"
                >{{ scene.id }}</span>
              </div>
              <div class="flex-1">
                <div class="font-medium text-sm">
                  {{ scene.title }}
                </div>
                <div
                  class="text-xs"
                  :class="scene.status === 'processing' ? 'text-purple-600' : 'text-muted-foreground'"
                >
                  {{ scene.status === 'completed' ? '已完成' : scene.status === 'processing' ? `生成中 ${scene.progress}%` : '等待中' }}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- 中间: 首尾帧预览 -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base">
            首尾帧预览
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <div>
              <div class="text-xs text-muted-foreground mb-2">
                第一帧 (起始状态)
              </div>
              <div class="aspect-video bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl flex items-center justify-center">
                <div class="text-center text-muted-foreground">
                  <Image class="w-12 h-12 mx-auto mb-2" />
                  <div class="text-sm">
                    首帧预览
                  </div>
                </div>
              </div>
            </div>

            <div class="flex justify-center">
              <ArrowDown class="w-6 h-6 text-muted-foreground" />
            </div>

            <div>
              <div class="text-xs text-muted-foreground mb-2">
                最后一帧 (结束状态)
              </div>
              <div class="aspect-video bg-gradient-to-br from-purple-100 to-pink-100 rounded-xl flex items-center justify-center">
                <div class="text-center text-muted-foreground">
                  <Image class="w-12 h-12 mx-auto mb-2" />
                  <div class="text-sm">
                    尾帧预览
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            class="w-full"
          >
            重新生成首尾帧
          </Button>
        </CardFooter>
      </Card>

      <!-- 右侧: 视频预览 -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base">
            视频预览
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="aspect-video bg-gray-900 rounded-xl flex items-center justify-center relative overflow-hidden">
            <div class="text-center text-gray-400">
              <PlayCircle class="w-16 h-16 mx-auto mb-2" />
              <div class="text-sm">
                等待视频生成...
              </div>
            </div>
            <!-- 进度条 -->
            <div class="absolute bottom-0 left-0 right-0 h-1 bg-gray-700">
              <div
                class="h-full bg-purple-500 transition-all"
                style="width: 45%"
              />
            </div>
          </div>

          <div class="mt-4 space-y-3">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">时长</span>
              <div class="flex space-x-2">
                <Button
                  v-for="d in [4, 6, 8]"
                  :key="d"
                  size="sm"
                  :variant="duration === d ? 'default' : 'outline'"
                  @click="duration = d"
                >
                  {{ d }}秒
                </Button>
              </div>
            </div>

            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">分辨率</span>
              <div class="flex space-x-2">
                <Button
                  v-for="r in ['720p', '1080p']"
                  :key="r"
                  size="sm"
                  :variant="resolution === r ? 'default' : 'outline'"
                  @click="resolution = r"
                >
                  {{ r }}
                </Button>
              </div>
            </div>

            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">音频</span>
              <Switch v-model:checked="audioEnabled" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
