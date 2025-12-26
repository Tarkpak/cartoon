<script setup lang="ts">
import { FileText, User, Video, FolderOpen, Sparkles, Users, Clapperboard } from 'lucide-vue-next'

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
    color: 'purple',
    path: '/workbench'
  },
  {
    icon: User,
    title: '角色生成',
    description: 'Nano Banana Pro 生成4K角色立绘，支持多表情变体',
    color: 'pink',
    path: '/characters'
  },
  {
    icon: Video,
    title: '视频生成',
    description: 'Veo 3.1 首尾帧插值技术，生成连贯的8秒动态视频',
    color: 'blue',
    path: '/video'
  }
]

// 快捷入口数据
const quickActions = [
  { icon: FolderOpen, label: '项目管理', path: '/projects', color: 'purple' },
  { icon: Sparkles, label: '开始创作', path: '/workbench', color: 'pink' },
  { icon: Users, label: '角色管理', path: '/characters', color: 'blue' },
  { icon: Clapperboard, label: '视频生成', path: '/video', color: 'green' }
]

const colorClasses = {
  purple: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    text: 'text-purple-600 dark:text-purple-400',
    hover: 'hover:border-purple-300 dark:hover:border-purple-700'
  },
  pink: {
    bg: 'bg-pink-100 dark:bg-pink-900/30',
    text: 'text-pink-600 dark:text-pink-400',
    hover: 'hover:border-pink-300 dark:hover:border-pink-700'
  },
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-600 dark:text-blue-400',
    hover: 'hover:border-blue-300 dark:hover:border-blue-700'
  },
  green: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-600 dark:text-green-400',
    hover: 'hover:border-green-300 dark:hover:border-green-700'
  }
}
</script>

<template>
  <div class="min-h-screen bg-background p-8">
    <!-- Hero 区域 -->
    <div class="bg-gradient-to-r from-purple-600 via-purple-500 to-pink-500 rounded-3xl p-8 md:p-12 text-white mb-8 relative overflow-hidden">
      <!-- 背景装饰 -->
      <div class="absolute inset-0 opacity-10">
        <div class="absolute top-0 right-0 w-96 h-96 bg-white rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2" />
        <div class="absolute bottom-0 left-0 w-64 h-64 bg-white rounded-full blur-3xl transform -translate-x-1/2 translate-y-1/2" />
      </div>
      
      <div class="relative z-10 max-w-3xl">
        <h1 class="text-3xl md:text-4xl lg:text-5xl font-bold mb-4 leading-tight">
          AI驱动的漫剧创作平台
        </h1>
        <p class="text-lg md:text-xl opacity-90 mb-8 leading-relaxed">
          从文本到视频，一键生成专业级AI漫剧。<br class="hidden sm:block">
          支持首尾帧控制、角色一致性、智能配音。
        </p>
        <div class="flex flex-wrap gap-4">
          <Button
            size="lg"
            class="bg-white text-purple-600 hover:bg-white/90 shadow-lg shadow-purple-900/20 font-semibold px-8"
            @click="navigateTo('/workbench')"
          >
            开始创作
          </Button>
          <button
            class="btn-hero-outline h-11 rounded-md px-8 border-2 font-semibold transition-colors"
            @click="navigateTo('/projects')"
          >
            查看演示
          </button>
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
          class="cursor-pointer border-2 border-transparent transition-all duration-300 hover:shadow-xl hover:-translate-y-1"
          :class="colorClasses[feature.color as keyof typeof colorClasses].hover"
          @click="navigateTo(feature.path)"
        >
          <CardHeader>
            <div
              class="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110"
              :class="colorClasses[feature.color as keyof typeof colorClasses].bg"
            >
              <component
                :is="feature.icon"
                class="w-7 h-7"
                :class="colorClasses[feature.color as keyof typeof colorClasses].text"
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
    <Card class="border-2">
      <CardContent class="pt-6">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div
            v-for="action in quickActions"
            :key="action.label"
            class="flex flex-col items-center p-4 rounded-2xl cursor-pointer transition-all duration-300 hover:bg-accent hover:-translate-y-1"
            @click="navigateTo(action.path)"
          >
            <div
              class="w-16 h-16 rounded-2xl flex items-center justify-center mb-3 transition-transform duration-300"
              :class="colorClasses[action.color as keyof typeof colorClasses].bg"
            >
              <component
                :is="action.icon"
                class="w-8 h-8"
                :class="colorClasses[action.color as keyof typeof colorClasses].text"
              />
            </div>
            <span class="text-sm font-medium text-foreground">{{ action.label }}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
