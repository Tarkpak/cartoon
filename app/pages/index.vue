<script setup lang="ts">
import { FileText, FolderOpen, Sparkles, Layers3, Film, ScrollText, Settings, History } from 'lucide-vue-next'
import { resolveProjectWorkbenchPath } from '#shared/types/project'

definePageMeta({
  layout: 'default'
})

const router = useRouter()

const lastProjectId = ref<string | null>(null)

onMounted(() => {
  if (typeof window === 'undefined') return
  lastProjectId.value = window.localStorage.getItem('playlet:last-project-id')
})

function navigateTo(path: string) {
  router.push(path)
}

// 开始创作：直接打开「新建项目」对话框
function startCreate() {
  router.push('/projects?new=1')
}

// 继续创作：回到最近一次打开的项目工作台
function continueLast() {
  if (!lastProjectId.value) return
  router.push(resolveProjectWorkbenchPath(lastProjectId.value))
}

// 功能展示卡片（说明产品能力，非独立入口）
const features = [
  {
    icon: FileText,
    title: '剧本解析',
    description: 'AI 智能解析小说/剧本文本，自动提取场景、角色、对话'
  },
  {
    icon: Layers3,
    title: '资产准备',
    description: '统一管理角色、环境和道具素材，保持全片视觉一致性'
  },
  {
    icon: Film,
    title: '分镜视频',
    description: '批量生成分镜片段并导出成片'
  }
]

// 快捷入口（各入口行为相互区分）
const quickActions = computed(() => [
  { icon: FolderOpen, label: '我的项目', handler: () => navigateTo('/projects') },
  { icon: Sparkles, label: '开始创作', handler: startCreate },
  ...(lastProjectId.value
    ? [{ icon: History, label: '继续创作', handler: continueLast }]
    : []),
  { icon: Settings, label: '设置', handler: () => navigateTo('/settings') },
  { icon: ScrollText, label: '调用日志', handler: () => navigateTo('/model-logs') }
])
</script>

<template>
  <div class="min-h-screen bg-background p-8">
    <!-- Hero 区域 -->
    <div class="bg-card border rounded-lg p-8 md:p-12 mb-8">
      <div class="max-w-3xl">
        <h1 class="text-3xl md:text-4xl lg:text-5xl font-bold mb-4 leading-tight text-foreground">
          AI 驱动的影视创作平台
        </h1>
        <p class="text-lg md:text-xl text-muted-foreground mb-8 leading-relaxed">
          从文本到视频，生成专业级 AI 影视内容。<br class="hidden sm:block">
          支持环境参考图、角色一致性、智能配音。
        </p>
        <div class="flex flex-wrap gap-4">
          <Button
            size="lg"
            class="font-semibold px-8"
            @click="startCreate"
          >
            开始创作
          </Button>
          <Button
            v-if="lastProjectId"
            variant="outline"
            size="lg"
            class="font-semibold px-8"
            @click="continueLast"
          >
            继续创作
          </Button>
        </div>
      </div>
    </div>

    <!-- 功能展示 -->
    <div class="mb-8">
      <h2 class="text-xl font-bold mb-6">
        核心功能
      </h2>
      <div class="grid md:grid-cols-3 gap-6">
        <Card
          v-for="feature in features"
          :key="feature.title"
        >
          <CardHeader>
            <div
              class="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-3"
            >
              <component
                :is="feature.icon"
                class="w-6 h-6 text-primary"
              />
            </div>
            <CardTitle class="text-lg">
              {{ feature.title }}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-muted-foreground leading-relaxed">
              {{ feature.description }}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- 快速入口 -->
    <Card>
      <CardContent class="pt-6">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-6">
          <button
            v-for="action in quickActions"
            :key="action.label"
            type="button"
            class="flex flex-col items-center p-4 rounded-md cursor-pointer transition-all duration-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @click="action.handler()"
          >
            <div
              class="w-14 h-14 rounded-md bg-muted flex items-center justify-center mb-3"
            >
              <component
                :is="action.icon"
                class="w-7 h-7 text-foreground"
              />
            </div>
            <span class="text-sm font-medium text-foreground">{{ action.label }}</span>
          </button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
