<script setup lang="ts">
import {
  Cloud,
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
import VideoEnhancePage from './video-enhance.vue'
import VideoEnhanceTasksPage from './video-enhance-tasks.vue'

definePageMeta({
  layout: 'default'
})

type EnhanceView = 'create' | 'tasks'
type EnhanceType = 'video' | 'image'
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
  getQueryValue(route.query.type as string | string[] | undefined) === 'image' ? 'image' : 'video'
))

const activeMode = computed<EnhanceMode>(() => (
  getQueryValue(route.query.mode as string | string[] | undefined) === 'local' ? 'local' : 'cloud'
))

const pageDescription = computed(() => {
  if (activeView.value === 'tasks') return '查看云端视频和图片增强任务的进度与结果。'
  return activeMode.value === 'local'
    ? '使用本机算力处理视频和图片，无需上传素材。'
    : '使用火山引擎 AI MediaKit 提升视频和图片画质。'
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
      title="画质增强"
      :description="pageDescription"
      class="min-h-16"
    >
      <template #actions>
        <div
          class="flex rounded-md border bg-muted/30 p-1"
          role="tablist"
          aria-label="画质增强页面"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="activeView === 'create'"
            class="inline-flex h-8 items-center rounded-sm px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px"
            :class="activeView === 'create' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            @click="switchView('create')"
          >
            <WandSparkles class="mr-2 h-4 w-4" />
            新建增强
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeView === 'tasks'"
            class="inline-flex h-8 items-center rounded-sm px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px"
            :class="activeView === 'tasks' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            @click="switchView('tasks')"
          >
            <ListChecks class="mr-2 h-4 w-4" />
            任务记录
          </button>
        </div>
      </template>
    </AppPageHeader>

    <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/10 px-4 py-3 sm:px-6">
      <div class="flex items-center gap-3">
        <span class="hidden text-xs font-medium text-muted-foreground sm:inline">素材类型</span>
        <div
          class="flex rounded-md border bg-background p-0.5"
          role="tablist"
          aria-label="素材类型"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="activeType === 'video'"
            class="inline-flex h-8 items-center rounded-sm px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
            :class="activeType === 'video' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="switchType('video')"
          >
            <FileVideo class="mr-2 h-4 w-4" />
            {{ activeView === 'tasks' ? '视频任务' : '视频' }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeType === 'image'"
            class="inline-flex h-8 items-center rounded-sm px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
            :class="activeType === 'image' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="switchType('image')"
          >
            <FileImage class="mr-2 h-4 w-4" />
            {{ activeView === 'tasks' ? '图片任务' : '图片' }}
          </button>
        </div>
      </div>

      <div
        v-if="activeView === 'create'"
        class="flex items-center gap-3"
      >
        <span class="hidden text-xs text-muted-foreground lg:inline">
          {{ activeMode === 'cloud' ? '效果更强，需要上传素材' : '无需上传，速度取决于设备性能' }}
        </span>
        <span class="hidden text-xs font-medium text-muted-foreground sm:inline">处理方式</span>
        <div
          class="flex rounded-md border bg-background p-0.5"
          role="tablist"
          aria-label="处理方式"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="activeMode === 'cloud'"
            class="inline-flex h-8 items-center rounded-sm px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
            :class="activeMode === 'cloud' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="switchMode('cloud')"
          >
            <Cloud class="mr-2 h-4 w-4" />
            云端
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeMode === 'local'"
            class="inline-flex h-8 items-center rounded-sm px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
            :class="activeMode === 'local' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="switchMode('local')"
          >
            <MonitorCog class="mr-2 h-4 w-4" />
            本地
          </button>
        </div>
      </div>
    </div>

    <template v-if="activeView === 'tasks'">
      <ImageEnhanceTasksPage v-if="activeType === 'image'" />
      <VideoEnhanceTasksPage v-else />
    </template>
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
