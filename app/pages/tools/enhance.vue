<script setup lang="ts">
import {
  Cloud,
  Eraser,
  FileImage,
  FileVideo,
  ListChecks,
  MonitorCog,
  WandSparkles
} from 'lucide-vue-next'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
import ImageEnhancePage from './image-enhance.vue'
import ImageEnhanceTasksPage from './image-enhance-tasks.vue'
import LocalImageEnhancePage from './local-image-enhance.vue'
import LocalVideoEnhancePage from './local-video-enhance.vue'
import SubtitleErasurePage from './subtitle-erasure.vue'
import SubtitleErasureTasksPage from './subtitle-erasure-tasks.vue'
import VideoEnhancePage from './video-enhance.vue'
import VideoEnhanceTasksPage from './video-enhance-tasks.vue'

definePageMeta({
  layout: 'default'
})

type EnhanceView = 'create' | 'tasks'
type EnhanceType = 'video' | 'image' | 'subtitle-erasure'
type EnhanceMode = 'cloud' | 'local'

const route = useRoute()
const router = useRouter()

function getQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

const activeView = computed<EnhanceView>(() => (
  getQueryValue(route.query.view as string | string[] | undefined) === 'tasks' ? 'tasks' : 'create'
))

const activeType = computed<EnhanceType>(() => (
  getQueryValue(route.query.type as string | string[] | undefined) === 'image'
    ? 'image'
    : getQueryValue(route.query.type as string | string[] | undefined) === 'subtitle-erasure'
      ? 'subtitle-erasure'
      : 'video'
))

const activeMode = computed<EnhanceMode>(() => (
  getQueryValue(route.query.mode as string | string[] | undefined) === 'local' ? 'local' : 'cloud'
))

const pageDescription = computed(() => {
  if (activeType.value === 'subtitle-erasure') {
    return activeView.value === 'tasks'
      ? '查看字幕擦除任务进度、预览并下载处理结果。'
      : '批量上传本地视频，移除画面内已合成的硬字幕。'
  }
  if (activeView.value === 'tasks') return '查看云端视频和图片增强任务的进度与结果。'
  return activeMode.value === 'local'
    ? '使用本机算力处理视频和图片，无需上传素材。'
    : '使用火山引擎 AI MediaKit 或 Topaz Labs 提升视频和图片画质。'
})

const VIEW_TABS = [
  { value: 'create' as const, label: '新建处理', icon: WandSparkles },
  { value: 'tasks' as const, label: '任务记录', icon: ListChecks }
]

const MODE_TABS = [
  { value: 'cloud' as const, label: '云端', icon: Cloud },
  { value: 'local' as const, label: '本地', icon: MonitorCog }
]

const typeTabs = computed(() => {
  const suffix = activeView.value === 'tasks' ? '任务' : ''
  return [
    { value: 'video' as const, label: `视频增强${suffix}`, icon: FileVideo },
    { value: 'image' as const, label: `图片增强${suffix}`, icon: FileImage },
    { value: 'subtitle-erasure' as const, label: `字幕擦除${suffix}`, icon: Eraser }
  ]
})

function updateQuery(updates: Record<string, string>, clearKeys: string[] = []) {
  const query = {
    ...route.query,
    ...updates
  }
  for (const key of clearKeys) delete query[key]
  void router.replace({
    path: '/tools/enhance',
    query
  })
}

function switchView(view: EnhanceView) {
  if (activeView.value === view) return
  updateQuery({ view }, ['taskId'])
}

function switchType(type: EnhanceType) {
  if (activeType.value === type) return
  updateQuery({ type }, ['taskId'])
}

function switchMode(mode: EnhanceMode) {
  if (activeMode.value === mode) return
  updateQuery({ mode }, ['taskId'])
}
</script>

<template>
  <AppPage>
    <AppPageHeader
      title="媒体处理"
      :description="pageDescription"
      class="min-h-16"
    >
      <template #actions>
        <SegmentedTabs
          :model-value="activeView"
          :items="VIEW_TABS"
          aria-label="媒体处理页面"
          @update:model-value="switchView"
        />
      </template>
    </AppPageHeader>

    <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/10 px-4 py-3 sm:px-6">
      <div class="flex items-center gap-3">
        <span class="hidden text-xs font-medium text-muted-foreground sm:inline">处理类型</span>
        <SegmentedTabs
          :model-value="activeType"
          :items="typeTabs"
          aria-label="处理类型"
          @update:model-value="switchType"
        />
      </div>

      <div
        v-if="activeView === 'create' && activeType !== 'subtitle-erasure'"
        class="flex items-center gap-3"
      >
        <span class="hidden text-xs text-muted-foreground lg:inline">
          {{ activeMode === 'cloud' ? '效果更强，需要上传素材' : '无需上传，速度取决于设备性能' }}
        </span>
        <span class="hidden text-xs font-medium text-muted-foreground sm:inline">处理方式</span>
        <SegmentedTabs
          :model-value="activeMode"
          :items="MODE_TABS"
          aria-label="处理方式"
          @update:model-value="switchMode"
        />
      </div>
    </div>

    <template v-if="activeView === 'tasks'">
      <SubtitleErasureTasksPage v-if="activeType === 'subtitle-erasure'" />
      <ImageEnhanceTasksPage v-else-if="activeType === 'image'" />
      <VideoEnhanceTasksPage v-else />
    </template>
    <SubtitleErasurePage v-else-if="activeType === 'subtitle-erasure'" />
    <template v-else-if="activeMode === 'local'">
      <LocalImageEnhancePage v-if="activeType === 'image'" />
      <LocalVideoEnhancePage v-else />
    </template>
    <template v-else>
      <ImageEnhancePage v-if="activeType === 'image'" />
      <VideoEnhancePage v-else />
    </template>
  </AppPage>
</template>
