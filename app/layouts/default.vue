<script setup lang="ts">
import { Home, Folder, FileText, Users, Video, Settings } from 'lucide-vue-next'

// 默认布局
const route = useRoute()

const navigation = [
  { name: '首页概览', path: '/', icon: Home },
  { name: '项目管理', path: '/projects', icon: Folder },
  { name: '生成工作台', path: '/workbench', icon: FileText },
  { name: '角色管理', path: '/characters', icon: Users },
  { name: '视频生成', path: '/video', icon: Video }
]

function isActive(path: string) {
  return route.path === path
}
</script>

<template>
  <div class="flex h-screen bg-background">
    <!-- 左侧菜单栏 -->
    <aside class="w-64 bg-card border-r flex flex-col">
      <!-- Logo -->
      <div class="h-16 flex items-center px-6 border-b">
        <NuxtLink
          to="/"
          class="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent"
        >
          🎬 Manju
        </NuxtLink>
      </div>

      <!-- 导航菜单 -->
      <nav class="flex-1 p-4 space-y-2">
        <NuxtLink
          v-for="item in navigation"
          :key="item.path"
          :to="item.path"
          class="flex items-center space-x-3 px-4 py-3 rounded-xl transition"
          :class="isActive(item.path)
            ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
            : 'text-muted-foreground hover:bg-accent'"
        >
          <component
            :is="item.icon"
            class="w-5 h-5"
          />
          <span class="font-medium">{{ item.name }}</span>
        </NuxtLink>
      </nav>

      <!-- 底部用户信息 -->
      <div class="p-4 border-t">
        <div class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-accent cursor-pointer">
          <div class="w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-white font-medium">
            U
          </div>
          <div class="flex-1">
            <div class="font-medium text-sm">
              用户名
            </div>
            <div class="text-xs text-muted-foreground">
              免费版
            </div>
          </div>
          <Settings class="w-5 h-5 text-muted-foreground" />
        </div>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <main class="flex-1 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
