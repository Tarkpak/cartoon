<script setup lang="ts">
import { FileImage, FileVideo } from 'lucide-vue-next'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
import ImageEnhancePage from './image-enhance.vue'
import VideoEnhancePage from './video-enhance.vue'

definePageMeta({
  layout: 'default'
})

type EnhanceType = 'video' | 'image'

const route = useRoute()
const router = useRouter()

const activeType = computed<EnhanceType>(() => {
  const raw = Array.isArray(route.query.type) ? route.query.type[0] : route.query.type
  return raw === 'image' ? 'image' : 'video'
})

function switchType(type: EnhanceType) {
  if (activeType.value === type) return
  void router.replace({
    path: '/tools/enhance',
    query: { type }
  })
}
</script>

<template>
  <AppPage>
    <AppPageHeader
      title="云端增强"
      description="统一提交视频和图片的火山引擎 AI MediaKit 增强任务。"
      class="h-16"
    >
      <template #actions>
        <div class="flex rounded-md border bg-muted/30 p-1">
          <button
            type="button"
            class="inline-flex items-center rounded-sm px-3 py-1.5 text-sm transition-colors"
            :class="activeType === 'video' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            @click="switchType('video')"
          >
            <FileVideo class="mr-2 h-4 w-4" />
            视频增强
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-sm px-3 py-1.5 text-sm transition-colors"
            :class="activeType === 'image' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            @click="switchType('image')"
          >
            <FileImage class="mr-2 h-4 w-4" />
            图片增强
          </button>
        </div>
      </template>
    </AppPageHeader>

    <ImageEnhancePage v-if="activeType === 'image'" />
    <VideoEnhancePage v-else />
  </AppPage>
</template>
