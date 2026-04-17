<script setup lang="ts">
import { FileText, FolderOpen, Sparkles, Layers3, Film, ScrollText, Settings } from 'lucide-vue-next'

definePageMeta({
  layout: 'default'
})

const router = useRouter()

function navigateTo(path: string) {
  router.push(path)
}

// 功能卡片数据
const features = [
  {
    icon: FileText,
    title: '剧本解析',
    description: 'Gemini 3 Pro 智能解析小说文本，自动提取场景、角色、对话',
    path: '/projects'
  },
  {
    icon: Layers3,
    title: '资产准备',
    description: '统一管理角色、环境和道具素材，保持全片视觉一致性',
    path: '/projects'
  },
  {
    icon: Film,
    title: '场景成片',
    description: '批量生成场景视频并导出最终成片，直接走现有资产工作流',
    path: '/projects'
  }
]

// 快捷入口数据
const quickActions = [
  { icon: FolderOpen, label: '项目管理', path: '/projects' },
  { icon: Sparkles, label: '开始创作', path: '/projects' },
  { icon: Layers3, label: '资产工作流', path: '/projects' },
  { icon: Settings, label: '系统设置', path: '/settings' },
  { icon: ScrollText, label: '模型日志', path: '/model-logs' }
]
</script>

<template>
  <div class="min-h-screen bg-background p-8">
    <!-- Hero 区域 -->
    <div class="bg-card border rounded-lg p-8 md:p-12 mb-8">
      <div class="max-w-3xl">
        <h1 class="text-3xl md:text-4xl lg:text-5xl font-bold mb-4 leading-tight text-foreground">
          AI驱动的影视创作平台
        </h1>
        <p class="text-lg md:text-xl text-muted-foreground mb-8 leading-relaxed">
          从文本到视频，一键生成专业级AI影视内容。<br class="hidden sm:block">
          支持首尾帧控制、角色一致性、智能配音。
        </p>
        <div class="flex flex-wrap gap-4">
          <Button
            size="lg"
            class="font-semibold px-8"
            @click="navigateTo('/projects')"
          >
            开始创作
          </Button>
          <Button
            variant="outline"
            size="lg"
            class="font-semibold px-8"
            @click="navigateTo('/projects')"
          >
            查看演示
          </Button>
        </div>
      </div>
    </div>

    <!-- 功能卡片 -->
    <div class="mb-8">
      <h2 class="text-xl font-bold mb-6">核心功能</h2>
      <div class="grid md:grid-cols-3 gap-6">
        <Card
          v-for="feature in features"
          :key="feature.title"
          class="cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
          @click="navigateTo(feature.path)"
        >
          <CardHeader>
            <div
              class="w-12 h-12 rounded-md bg-muted flex items-center justify-center mb-3"
            >
              <component
                :is="feature.icon"
                class="w-6 h-6 text-foreground"
              />
            </div>
            <CardTitle class="text-lg">{{ feature.title }}</CardTitle>
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
          <div
            v-for="action in quickActions"
            :key="action.label"
            class="flex flex-col items-center p-4 rounded-md cursor-pointer transition-all duration-200 hover:bg-accent"
            @click="navigateTo(action.path)"
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
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
