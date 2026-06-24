<script setup lang="ts">
import { FileImage, FileVideo } from 'lucide-vue-next'
import ImageEnhanceTasksPage from './image-enhance-tasks.vue'
import VideoEnhanceTasksPage from './video-enhance-tasks.vue'

definePageMeta({
  layout: 'default'
})

type TaskType = 'video' | 'image'

const route = useRoute()
const router = useRouter()

const activeType = computed<TaskType>(() => {
  const raw = Array.isArray(route.query.type) ? route.query.type[0] : route.query.type
  return raw === 'image' ? 'image' : 'video'
})

function switchType(type: TaskType) {
  if (activeType.value === type) return
  void router.replace({
    path: '/tools/enhance-tasks',
    query: { type }
  })
}
</script>

<template>
  <div class="border-b bg-background px-6 pt-6 lg:px-8">
    <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 pb-4">
      <div>
        <h1 class="text-xl font-semibold text-foreground">
          增强任务
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
          统一查看视频和图片云端增强任务。
        </p>
      </div>
      <div class="flex rounded-md border bg-muted/30 p-1">
        <button
          type="button"
          class="inline-flex items-center rounded-sm px-3 py-1.5 text-sm transition-colors"
          :class="activeType === 'video' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="switchType('video')"
        >
          <FileVideo class="mr-2 h-4 w-4" />
          视频任务
        </button>
        <button
          type="button"
          class="inline-flex items-center rounded-sm px-3 py-1.5 text-sm transition-colors"
          :class="activeType === 'image' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="switchType('image')"
        >
          <FileImage class="mr-2 h-4 w-4" />
          图片任务
        </button>
      </div>
    </div>
  </div>

  <ImageEnhanceTasksPage v-if="activeType === 'image'" />
  <VideoEnhanceTasksPage v-else />
</template>
