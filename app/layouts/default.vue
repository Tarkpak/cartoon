<script setup lang="ts">
import { Home, Folder, Settings, Moon, Sun, Clapperboard, Workflow, FlaskConical, FileText, Palette, ScrollText } from 'lucide-vue-next'

const route = useRoute()
const { isDark, toggleTheme, initTheme } = useTheme()

// 侧边栏折叠状态
const isCollapsed = useState('sidebar-collapsed', () => false)
const SIDEBAR_COLLAPSE_STORAGE_KEY = 'manju:sidebar-collapsed'

const navigation = [
  { name: '首页概览', path: '/', icon: Home },
  { name: '项目管理', path: '/projects', icon: Folder },
  { name: '模型日志', path: '/model-logs', icon: ScrollText },
  { name: '设置', path: '/settings', icon: Settings }
]

type SettingsSection = 'models' | 'prompts' | 'styles'
type SettingsModelSub = 'workflow' | 'test'

const settingsSubNavigation: Array<{
  name: string
  section: SettingsSection
  sub?: SettingsModelSub
  icon: unknown
}> = [
  { name: '业务流程配置', section: 'models', sub: 'workflow', icon: Workflow },
  { name: '模型测试', section: 'models', sub: 'test', icon: FlaskConical },
  { name: '提示词配置', section: 'prompts', icon: FileText },
  { name: '画风预设', section: 'styles', icon: Palette }
]

function getSingleQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

const currentSettingsSection = computed<SettingsSection>(() => {
  const raw = getSingleQueryValue(route.query.section as string | string[] | undefined)
  if (raw === 'prompts' || raw === 'styles' || raw === 'models') {
    return raw
  }
  return 'models'
})

const currentSettingsModelSub = computed<SettingsModelSub>(() => {
  const raw = getSingleQueryValue(route.query.sub as string | string[] | undefined)
  return raw === 'test' ? 'test' : 'workflow'
})

function isSettingsSubActive(item: { section: SettingsSection, sub?: SettingsModelSub }): boolean {
  if (route.path !== '/settings') return false
  if (currentSettingsSection.value !== item.section) return false
  if (item.section !== 'models') return true
  return currentSettingsModelSub.value === (item.sub || 'workflow')
}

function getSettingsSubRoute(item: { section: SettingsSection, sub?: SettingsModelSub }) {
  if (item.section === 'models') {
    return {
      path: '/settings',
      query: { section: item.section, sub: item.sub || 'workflow' }
    }
  }

  return {
    path: '/settings',
    query: { section: item.section }
  }
}

const activeStates = computed(() => {
  return navigation.map(item => route.path === item.path)
})

// 是否显示页脚（设置页与自动工作台不显示）
const showFooter = computed(() => !['/settings', '/asset-workbench'].includes(route.path))

// 初始化主题
onMounted(() => {
  initTheme()

  if (typeof window === 'undefined') return

  const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY)
  if (stored === '1' || stored === 'true') {
    isCollapsed.value = true
  } else if (stored === '0' || stored === 'false') {
    isCollapsed.value = false
  }
})

watch(isCollapsed, (value) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, value ? '1' : '0')
})
</script>

<template>
  <div class="flex h-screen bg-background transition-colors duration-300">
    <!-- 左侧菜单栏 -->
    <aside
      class="bg-card border-r flex flex-col transition-all duration-300 relative"
      :class="isCollapsed ? 'w-20' : 'w-64'"
    >
      <!-- 折叠按钮 - 使用双箭头图标避免与返回按钮混淆 -->
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="absolute -right-3 top-20 w-6 h-6 bg-muted border rounded-full flex items-center justify-center shadow-sm hover:bg-accent transition z-10"
        :title="isCollapsed ? '展开菜单' : '收起菜单'"
        @click="isCollapsed = !isCollapsed"
      >
        <svg v-if="!isCollapsed" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground">
          <path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground">
          <path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>
        </svg>
      </Button>

      <!-- Logo -->
      <div class="h-16 flex items-center border-b" :class="isCollapsed ? 'justify-center px-2' : 'px-6'">
        <NuxtLink
          to="/"
          class="font-bold text-foreground flex items-center"
          :class="isCollapsed ? 'text-xl' : 'text-2xl'"
        >
          <Clapperboard class="w-6 h-6 text-primary" />
          <span v-if="!isCollapsed" class="ml-1">Manju</span>
        </NuxtLink>
      </div>

      <!-- 导航菜单 -->
      <nav class="flex-1 p-4 space-y-1">
        <div
          v-for="(item, index) in navigation"
          :key="item.path"
          class="relative group"
        >
          <NuxtLink
            :to="item.path"
            class="flex items-center rounded-md transition-colors duration-200"
            :class="[
              isCollapsed ? 'justify-center px-2 py-2.5' : 'space-x-3 px-3 py-2.5',
              activeStates[index]
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            ]"
            :title="isCollapsed ? item.name : undefined"
          >
            <component :is="item.icon" class="w-5 h-5 flex-shrink-0" />
            <span v-if="!isCollapsed">{{ item.name }}</span>
          </NuxtLink>

          <div
            v-if="item.path === '/settings' && route.path === '/settings' && !isCollapsed"
            class="mt-1 ml-8 space-y-0.5"
          >
            <NuxtLink
              v-for="sub in settingsSubNavigation"
              :key="`${sub.section}-${sub.sub || 'root'}`"
              :to="getSettingsSubRoute(sub)"
              class="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors"
              :class="isSettingsSubActive(sub)
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
            >
              <component :is="sub.icon" class="w-3.5 h-3.5 flex-shrink-0" />
              <span>{{ sub.name }}</span>
            </NuxtLink>
          </div>

          <div
            v-if="item.path === '/settings' && isCollapsed"
            class="absolute left-full top-0 z-30 w-48 rounded-md border bg-popover p-1 shadow-md opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
          >
            <NuxtLink
              v-for="sub in settingsSubNavigation"
              :key="`collapsed-${sub.section}-${sub.sub || 'root'}`"
              :to="getSettingsSubRoute(sub)"
              class="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors"
              :class="isSettingsSubActive(sub)
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
            >
              <component :is="sub.icon" class="w-3.5 h-3.5 flex-shrink-0" />
              <span>{{ sub.name }}</span>
            </NuxtLink>
          </div>
        </div>
      </nav>

      <!-- 主题切换 -->
      <div class="px-4 pb-2">
        <Button
          type="button"
          variant="ghost"
          class="w-full flex items-center rounded-md transition-colors duration-200 text-muted-foreground hover:bg-accent hover:text-foreground"
          :class="isCollapsed ? 'justify-center px-2 py-2.5' : 'space-x-3 px-3 py-2.5'"
          @click="toggleTheme"
        >
          <Moon v-if="!isDark" class="w-5 h-5 flex-shrink-0" />
          <Sun v-else class="w-5 h-5 flex-shrink-0" />
          <span v-if="!isCollapsed">{{ isDark ? '浅色模式' : '深色模式' }}</span>
        </Button>
      </div>

      <!-- 底部用户信息 -->
      <div class="p-4 border-t">
        <div
          class="flex items-center rounded-md hover:bg-accent cursor-pointer transition-colors duration-200"
          :class="isCollapsed ? 'justify-center p-2' : 'space-x-3 px-3 py-2.5'"
        >
          <div class="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-foreground font-medium flex-shrink-0">
            U
          </div>
          <template v-if="!isCollapsed">
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">用户名</div>
              <div class="text-xs text-muted-foreground">免费版</div>
            </div>
            <Settings class="w-4 h-4 text-muted-foreground flex-shrink-0" />
          </template>
        </div>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <main class="flex-1 overflow-hidden flex flex-col">
      <div class="flex-1 overflow-y-auto" :class="{ 'overflow-hidden': !showFooter }">
        <slot />
      </div>
      
      <!-- 页脚 - 设置页面不显示 -->
      <footer v-if="showFooter" class="flex-shrink-0 px-8 py-6 border-t bg-card/50">
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
