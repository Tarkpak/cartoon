<script setup lang="ts">
import { Home, Folder, Settings, Moon, Sun, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const route = useRoute()
const { isDark, toggleTheme, initTheme } = useTheme()

// 侧边栏折叠状态
const isCollapsed = useState('sidebar-collapsed', () => false)

const navigation = [
  { name: '首页概览', path: '/', icon: Home },
  { name: '项目管理', path: '/projects', icon: Folder },
  { name: '模型设置', path: '/settings', icon: Settings }
]

const activeStates = computed(() => {
  return navigation.map(item => route.path === item.path)
})

// 初始化主题
onMounted(() => {
  initTheme()
})
</script>

<template>
  <div class="flex h-screen bg-background transition-colors duration-300">
    <!-- 左侧菜单栏 -->
    <aside
      class="bg-card border-r flex flex-col transition-all duration-300 relative"
      :class="isCollapsed ? 'w-20' : 'w-64'"
    >
      <!-- 折叠按钮 -->
      <button
        class="absolute -right-3 top-20 w-6 h-6 bg-card border rounded-full flex items-center justify-center shadow-sm hover:bg-accent transition z-10"
        @click="isCollapsed = !isCollapsed"
      >
        <ChevronLeft v-if="!isCollapsed" class="w-4 h-4 text-muted-foreground" />
        <ChevronRight v-else class="w-4 h-4 text-muted-foreground" />
      </button>

      <!-- Logo -->
      <div class="h-16 flex items-center border-b" :class="isCollapsed ? 'justify-center px-2' : 'px-6'">
        <NuxtLink
          to="/"
          class="font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent flex items-center"
          :class="isCollapsed ? 'text-xl' : 'text-2xl'"
        >
          <span class="text-2xl">🎬</span>
          <span v-if="!isCollapsed" class="ml-1">Manju</span>
        </NuxtLink>
      </div>

      <!-- 导航菜单 -->
      <nav class="flex-1 p-4 space-y-2">
        <NuxtLink
          v-for="(item, index) in navigation"
          :key="item.path"
          :to="item.path"
          class="flex items-center rounded-xl transition-all duration-200"
          :class="[
            isCollapsed ? 'justify-center px-2 py-3' : 'space-x-3 px-4 py-3',
            activeStates[index]
              ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          ]"
          :title="isCollapsed ? item.name : undefined"
        >
          <component :is="item.icon" class="w-5 h-5 flex-shrink-0" />
          <span v-if="!isCollapsed" class="font-medium">{{ item.name }}</span>
        </NuxtLink>
      </nav>

      <!-- 主题切换 -->
      <div class="px-4 pb-2">
        <button
          class="w-full flex items-center rounded-xl transition-all duration-200 text-muted-foreground hover:bg-accent hover:text-foreground"
          :class="isCollapsed ? 'justify-center px-2 py-3' : 'space-x-3 px-4 py-3'"
          @click="toggleTheme"
        >
          <Moon v-if="!isDark" class="w-5 h-5 flex-shrink-0" />
          <Sun v-else class="w-5 h-5 flex-shrink-0" />
          <span v-if="!isCollapsed" class="font-medium">{{ isDark ? '浅色模式' : '深色模式' }}</span>
        </button>
      </div>

      <!-- 底部用户信息 -->
      <div class="p-4 border-t">
        <div
          class="flex items-center rounded-xl hover:bg-accent cursor-pointer transition-all duration-200"
          :class="isCollapsed ? 'justify-center p-2' : 'space-x-3 px-4 py-3'"
        >
          <div class="w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-white font-medium shadow-lg shadow-purple-500/25 flex-shrink-0">
            U
          </div>
          <template v-if="!isCollapsed">
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">用户名</div>
              <div class="text-xs text-muted-foreground">
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 text-purple-700 dark:text-purple-300">
                  免费版
                </span>
              </div>
            </div>
            <Settings class="w-5 h-5 text-muted-foreground flex-shrink-0" />
          </template>
        </div>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <main class="flex-1 overflow-y-auto">
      <slot />
      
      <!-- 页脚 -->
      <footer class="px-8 py-6 border-t bg-card/50 mt-8">
        <div class="flex items-center justify-between text-sm text-muted-foreground">
          <div class="flex items-center space-x-4">
            <span>© 2025 Manju</span>
            <a href="#" class="hover:text-foreground transition">帮助文档</a>
            <a href="#" class="hover:text-foreground transition">反馈建议</a>
          </div>
          <div>v1.0.0</div>
        </div>
      </footer>
    </main>
  </div>
</template>
