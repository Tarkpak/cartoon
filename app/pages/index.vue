<script setup lang="ts">
import { FileText, User, Video } from 'lucide-vue-next'

// 首页
definePageMeta({
  layout: 'default'
})

const router = useRouter()

function navigateTo(path: string) {
  router.push(path)
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <!-- Hero 区域 -->
    <div class="bg-gradient-to-r from-purple-600 to-pink-600 rounded-3xl p-12 text-white mb-8 mx-8 mt-8">
      <div class="max-w-2xl">
        <h1 class="text-4xl font-bold mb-4">
          AI驱动的漫剧创作平台
        </h1>
        <p class="text-xl opacity-90 mb-8">
          从文本到视频，一键生成专业级AI漫剧。支持首尾帧控制、角色一致性、智能配音。
        </p>
        <div class="flex space-x-4">
          <Button
            size="lg"
            class="bg-white text-purple-600 hover:bg-gray-100"
            @click="navigateTo('/workbench')"
          >
            开始创作
          </Button>
          <Button
            size="lg"
            variant="ghost"
            class="text-white border-white hover:bg-white/20"
            @click="navigateTo('/projects')"
          >
            查看演示
          </Button>
        </div>
      </div>
    </div>

    <!-- 功能卡片 -->
    <div class="px-8 mb-8">
      <h2 class="text-xl font-bold mb-4">
        核心功能
      </h2>
      <div class="grid md:grid-cols-3 gap-6">
        <Card
          class="cursor-pointer hover:shadow-lg transition"
          @click="navigateTo('/workbench')"
        >
          <CardHeader>
            <div class="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mb-2">
              <FileText class="w-6 h-6 text-purple-600" />
            </div>
            <CardTitle class="text-lg">
              剧本解析
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-muted-foreground">
              Gemini 3 Pro 智能解析小说文本，自动提取场景、角色、对话
            </p>
          </CardContent>
        </Card>

        <Card
          class="cursor-pointer hover:shadow-lg transition"
          @click="navigateTo('/characters')"
        >
          <CardHeader>
            <div class="w-12 h-12 bg-pink-100 rounded-xl flex items-center justify-center mb-2">
              <User class="w-6 h-6 text-pink-600" />
            </div>
            <CardTitle class="text-lg">
              角色生成
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-muted-foreground">
              Nano Banana Pro 生成4K角色立绘，支持多表情变体
            </p>
          </CardContent>
        </Card>

        <Card
          class="cursor-pointer hover:shadow-lg transition"
          @click="navigateTo('/video')"
        >
          <CardHeader>
            <div class="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-2">
              <Video class="w-6 h-6 text-blue-600" />
            </div>
            <CardTitle class="text-lg">
              视频生成
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-muted-foreground">
              Veo 3.1 首尾帧插值技术，生成连贯的8秒动态视频
            </p>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- 快速入口 -->
    <div class="px-8">
      <Card>
        <CardContent class="pt-6">
          <div class="grid md:grid-cols-4 gap-8 text-center">
            <div
              class="cursor-pointer hover:opacity-80"
              @click="navigateTo('/projects')"
            >
              <div class="text-3xl font-bold text-purple-600">
                📁
              </div>
              <div class="text-muted-foreground mt-1">
                项目管理
              </div>
            </div>
            <div
              class="cursor-pointer hover:opacity-80"
              @click="navigateTo('/workbench')"
            >
              <div class="text-3xl font-bold text-pink-600">
                ✨
              </div>
              <div class="text-muted-foreground mt-1">
                开始创作
              </div>
            </div>
            <div
              class="cursor-pointer hover:opacity-80"
              @click="navigateTo('/characters')"
            >
              <div class="text-3xl font-bold text-blue-600">
                👥
              </div>
              <div class="text-muted-foreground mt-1">
                角色管理
              </div>
            </div>
            <div
              class="cursor-pointer hover:opacity-80"
              @click="navigateTo('/video')"
            >
              <div class="text-3xl font-bold text-green-600">
                🎬
              </div>
              <div class="text-muted-foreground mt-1">
                视频生成
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
