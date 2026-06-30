<script setup lang="ts">
import { FileImage, FileVideo } from 'lucide-vue-next'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
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
  <AppPage>
    <AppPageHeader
      title="增强任务"
      description="统一查看视频和图片云端增强任务。"
      class="h-16"
    >
      <template #actions>
        <div class="flex rounded-lg border bg-muted/40 p-1 shadow-sm">
          <button
            type="button"
            class="inline-flex h-9 items-center rounded-md px-4 text-sm font-semibold transition-colors"
            :class="activeType === 'video' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'"
            @click="switchType('video')"
          >
            <FileVideo class="mr-2 h-4 w-4" />
            视频任务
          </button>
          <button
            type="button"
            class="inline-flex h-9 items-center rounded-md px-4 text-sm font-semibold transition-colors"
            :class="activeType === 'image' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'"
            @click="switchType('image')"
          >
            <FileImage class="mr-2 h-4 w-4" />
            图片任务
          </button>
        </div>
      </template>
    </AppPageHeader>

    <ImageEnhanceTasksPage v-if="activeType === 'image'" />
    <VideoEnhanceTasksPage v-else />
  </AppPage>
</template>
