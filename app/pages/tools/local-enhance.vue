<script setup lang="ts">
import { FileImage, FileVideo } from 'lucide-vue-next'
import LocalImageEnhancePage from './local-image-enhance.vue'
import LocalVideoEnhancePage from './local-video-enhance.vue'

definePageMeta({
  layout: 'default'
})

type LocalEnhanceType = 'video' | 'image'

const route = useRoute()
const router = useRouter()

const activeType = computed<LocalEnhanceType>(() => {
  const raw = Array.isArray(route.query.type) ? route.query.type[0] : route.query.type
  return raw === 'image' ? 'image' : 'video'
})

function switchType(type: LocalEnhanceType) {
  if (activeType.value === type) return
  void router.replace({
    path: '/tools/local-enhance',
    query: { type }
  })
}
</script>

<template>
  <div class="border-b bg-background px-6 pt-6 lg:px-8">
    <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 pb-4">
      <div>
        <h1 class="text-xl font-semibold text-foreground">
          本地增强
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
          统一处理视频和图片的本机 FFmpeg 增强任务。
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
          视频处理
        </button>
        <button
          type="button"
          class="inline-flex items-center rounded-sm px-3 py-1.5 text-sm transition-colors"
          :class="activeType === 'image' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="switchType('image')"
        >
          <FileImage class="mr-2 h-4 w-4" />
          图片处理
        </button>
      </div>
    </div>
  </div>

  <LocalImageEnhancePage v-if="activeType === 'image'" />
  <LocalVideoEnhancePage v-else />
</template>
